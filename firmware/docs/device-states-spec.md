# Feature spec: device states, screens and gestures

**Status:** 📋 approved 2026-09-05 — implementing.
**Owner:** Baldur (product). Applies to firmware ≥ 0.5.0 on the T-Beam S3 Supreme.
**Related:** [`device-data`](../../docs/features/device-data.md) (what gets recorded),
[`device-uplink`](../../docs/features/device-uplink.md) (how it reaches paddlesnitch).

## Why

The device accumulated modes — setup, linking, tracking, recording, diagnostics —
without ever declaring them, so `loop()` decided what to draw from a pile of
booleans. This names the states, fixes what each one shows, and moves everything
the user cannot act on out of the normal path.

Guiding rule: **the screen shows what the user needs to do or know right now.**
Anything else is either background work or Nerd mode.

## States

Exactly one is active. `Nerd` overlays any state and returns to it.

| State | Entered when | Screen | Tap | Double-tap | Hold 3 s |
|---|---|---|---|---|---|
| **Intro** | power on | "P" with an orbiting satellite, ~1.5 s | — | — | — |
| **Setup** | no WiFi saved, or requested | AP name, `192.168.4.1`, and why | — | — | — |
| **Linking** | on WiFi, no device token | claim code, large, + `paddlesnitch.com` | — | — | — |
| **Waiting** | linked, no GNSS fix | top row only | *refused* | Nerd | Setup |
| **Ready** | linked, has fix | top row, speed, "Press to record" | start recording | Nerd | Setup |
| **Recording** | user started it | top row, speed, time + distance | stop recording | Nerd | — |
| **Nerd** | double-tap | diagnostics (below) | — | back | — |

The **top row** is constant: satellite (blinking until fix, solid after), signal
bars, REC dot while recording, battery gauge.

### Recording requires a fix

A tap in **Waiting** does not start a recording — it briefly shows `NEED GPS`
instead. A session that begins before a fix produces exactly the fix-less rows
that made all 31 of the first uploads return `422`. The satellite must be solid
before recording is offered.

### Nerd mode

Everything removed from the normal screens, on one page: satellites, HDOP, fix
age, IP address, SSID, device id, claim state, row count, file name, LoRa
parameters, TX counters, battery voltage, free heap. Reachable **without a
laptop**, because the situations where it is needed happen on the water.

Serial commands remain the deeper tool and are unchanged.

## Background behaviour

### Upload is silent and runs on the second core

`uplink` runs as a FreeRTOS task pinned to **core 0**; the UI, GNSS and logging
loop stay on core 1. HTTP calls block for seconds at a time, and a frozen screen
during a sync is exactly the kind of thing that reads as a crash.

The task never draws. It publishes status into a mutex-guarded struct that Nerd
mode reads. The only time a sync reaches the normal screens is when it needs the
user: not linked, or no WiFi configured.

**Sync is attempted at boot, when a recording stops, and every 5 minutes
thereafter — but never while recording.** The retry timer is not optional: a
recording that finishes away from WiFi cannot upload at the time, and if the
device does not lose power on the way home it would otherwise never try again.
This is exactly what happened on the first real outing — the session sat on the
card until a sync was triggered by hand. Suppressing retries while recording
matters too: a doomed 15 s WiFi attempt every few minutes is pure battery cost
out on the water.

### Uploads never run while recording

Both cores would otherwise touch the SD card at once. Rather than hold a lock
across a multi-second upload — which would stall row logging — the rule is
simpler: **the sync task does no SD work while a recording is active.** Starting
a recording asks the task to yield and waits briefly for it to finish the file in
flight.

### Confirmed uploads are deleted, but the last 5 sessions always stay

After the server confirms a file (`200`, `201`, or `409`), it becomes eligible
for deletion. Actual deletion keeps the **5 most recent sessions on the card
regardless of status**.

This is deliberately conservative. Deleting on confirmation alone is one
server-side bug away from losing a paddle that exists nowhere else, and the card
is 244 GB — space is not the constraint. Files rejected with `422` are *not*
deleted automatically; they are already recorded in `/uploaded.txt` so they are
never re-sent, and they are the evidence if a parse problem is ever suspected.

## Gestures

One button (GPIO0); `RST` is wired to the AXP2101 power key and cannot be used.

| Gesture | Action |
|---|---|
| Tap (< 400 ms) | start/stop recording |
| Double-tap (two taps < 400 ms apart) | Nerd mode on/off |
| Hold 3 s | Setup / re-link |

A single tap is therefore confirmed ~400 ms after release, so recording starts
marginally later than the press. That is the price of a third gesture on one
button, and it is invisible in practice next to a 1 Hz log rate.

## Testing

- Tap in `Waiting` does not create a file and shows `NEED GPS`.
- Tap in `Ready` creates exactly one file; a second tap closes it.
- Starting a recording during a sync yields the task and does not corrupt either
  the log file or the upload.
- Retention keeps the newest 5 sessions with a confirmed upload present.
- `422` files survive retention.
- Nerd mode toggles from and returns to whichever state was active.
