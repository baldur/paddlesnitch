# Feature spec: device screens, gestures and always-on sync

**Status:** ✅ implemented + verified on hardware 2026-09-12 (firmware 0.4.0).
Verified: boot lands on `pick>track` (serial `STATUS` reports the screen); a real
recording named `track_20260912_130850.csv` sync-on-stop uploaded `201` (no reformat
collision); Sync counts via `STATUS`; cold-boot sync; and the owner exercised the
button path on the device — Pick → Sync → hold-to-delete cleared both confirmed
uploads, leaving `uploaded.txt` intact and counts at 0/0/0.
**Owner:** Baldur (product). Targets firmware **0.4.0** on the T-Beam S3 Supreme
(bumped from 0.3.0; the server reads `X-Device-Firmware`, so the bump ships with this).
**Related:** [`device-data`](../../docs/features/device-data.md) (what gets recorded),
[`device-uplink`](../../docs/features/device-uplink.md) (how it reaches paddlesnitch).

**Supersedes** the 2026-09-05 state-machine version of this doc. That version modelled
one active state out of `Intro → Setup → Linking → Waiting → Ready → Recording`. This
version keeps the onboarding states but changes the post-onboarding model: the device
is not "in a mode" — it **always** acquires GPS and **always** runs the uploader. What
the user picks is only **which screen** they are looking at.

## Why

Two real problems drove this:

1. **"It didn't upload when I plugged it in."** Reported twice. The device was healthy
   every time — the upload is just on a cadence (power-on, then every 5 min), never
   instant, and a cold-boot WiFi attempt can miss. There was also no on-device way to
   see *whether* anything was waiting to upload. Users need the upload to be visible and
   to happen promptly after a paddle, without a serial cable.
2. **Filenames collide on the server after a reformat.** Sessions are named
   `track_0001.csv`, `0002`, … (first free index). After the card is reformatted the
   counter restarts at `0001`, but the server dedupes uploads by **deviceId + filename**
   — so a brand-new `track_0001.csv` comes back `409 "already have it"`, the firmware
   marks it done, and **the new paddle is silently never stored.** Timestamp-based names
   make every filename unique for the life of the device and remove the collision.

Guiding rule, unchanged: **the screen shows what the user needs to do or know right now.**

## The model: always-on work, user-selected screen

At power-on: the **Intro** spinner (the "P" with an orbiting satellite) shows while
`boardInit()` runs. From then on, two things run continuously in the background,
regardless of the visible screen:

- **GPS acquisition** — always on, so a fix is ready whenever the user wants to record.
- **The uploader** — the core-0 task described under *Background behaviour*.

The user is never blocked waiting for either. They only choose a **screen**.

### Onboarding still gates (it has to)

Until the device is usable, onboarding screens take over the display — background work
can't paper over missing setup:

| Screen | Shown when | Content |
|---|---|---|
| **Intro** | power-on, ~1.5 s | "P" + orbiting satellite |
| **Setup** | no WiFi saved, or requested | AP name, `192.168.4.1`, and why |
| **Linking** | on WiFi, no device token | claim code, large, + `paddlesnitch.com` |

Once WiFi is configured and the device is linked, **every boot lands on the Pick
chooser** (after the splash); the user taps to move the highlight and holds to open a
screen.

### The Pick chooser

Shown at boot, and returned to by a double-tap from any screen. Lists the three
screens with a highlight bar; **tap** moves the highlight (Track → Sync → Nerd), **hold**
opens the highlighted one. GPS and the uploader keep running the whole time — Pick only
chooses the view, it does not gate anything. The top row (below) shows here too, so fix
and battery are visible while choosing.

### The three screens

Opened from Pick; a **double-tap** returns to Pick. The **top row** is constant on Track,
Sync and Pick: satellite glyph (blinking until fix, solid after), WiFi/signal indicator,
REC dot while recording, battery gauge.

| Screen | Shows | Purpose |
|---|---|---|
| **Track** | speed, and either `Press to record` (fix) / `NEED GPS` (no fix) / time + distance (recording) | the paddling view |
| **Sync** | `ACTIVITIES n` · `UPLOADED m` · `PENDING p`, last-sync result, and the delete action | see what's waiting and manage the card |
| **Nerd** | diagnostics (sats, HDOP, fix age, IP, SSID, device id, claim state, row count, current file, LoRa params, TX counters, battery V, free heap) | on-water diagnosis, no laptop |

**Recording still requires a fix.** A record attempt on Track with no fix shows `NEED GPS`
and starts nothing — a fix-less session is exactly the junk that returned `422`. The
satellite glyph must be solid before recording is offered.

### Sync screen counts — definitions

- **ACTIVITIES (n)** — `track_*.csv` files currently on the card.
- **UPLOADED (m)** — files recorded in `/uploaded.txt` with a server-confirmed code
  (`200`/`201`/`409`).
- **PENDING (p)** — `n − m` (not-yet-confirmed; includes files that have only ever
  failed, and the one currently being recorded).

Counts are **not** recomputed every frame (an SD directory scan is not free). The
uploader publishes them after every sync pass, and they are refreshed when the Sync
screen is entered and after a delete. Nerd mode also shows them.

## Gestures

One button (GPIO0); `RST` is the AXP2101 power key and cannot be used as input. Three
gestures, now **context-sensitive to the visible screen**:

| Gesture | Pick | Track | Sync | Nerd | Onboarding |
|---|---|---|---|---|---|
| **Tap** (<400 ms) | move highlight | start / stop recording | **sync now** (force an upload) | — | — |
| **Double-tap** | — | → Pick | → Pick | → Pick | — |
| **Hold 3 s** | **open highlighted** | Setup / re-link | **delete uploaded → confirm** | Setup / re-link | Setup / re-link |

Notes:
- **Setup is reachable** via Hold on Track (the screen you open by default) and Nerd, and
  during onboarding — the escape hatch for a changed router password is preserved. On
  Pick, Hold opens the highlighted screen; on Sync, Hold arms the delete. Those are the
  two screens where Hold does not open Setup.
- A tap is confirmed ~400 ms after release (the double-tap window). Invisible next to a
  1 Hz log rate.

### Delete-uploaded confirm flow

`Hold 3 s` on the Sync screen opens a dedicated **confirm screen**:

```
DELETE m UPLOADED FILES?
tap = confirm   double-tap = cancel
(auto-cancels in 10 s)
```

- **Tap** deletes every file with a confirmed code (`200`/`201`/`409`) from `/uploaded.txt`.
- **Double-tap** or a 10 s timeout cancels and returns to Sync.
- Files that are **not** confirmed — `422` (rejected) and never-uploaded — are **never**
  deleted, and the currently-recording file is never touched.
- This **drops the old "always keep the newest 5" safety**: deletion is now a deliberate,
  confirmed, user-initiated act, and after a `200` paddlesnitch is the system of record.

## Background behaviour

### Upload is silent and runs on core 0

`uplink` is a FreeRTOS task pinned to **core 0**; UI, GNSS and logging stay on core 1.
HTTP blocks for seconds, and a frozen screen during a sync reads as a crash. The task
never draws; it publishes status (counts, last result, WiFi state) into a mutex-guarded
struct the UI reads. The only time a sync reaches the normal screens is when it needs the
user (not linked, or no WiFi configured).

### When a sync is attempted

**At boot, immediately when a recording stops, on a user `sync now` tap, and every 5 min
thereafter — but never while recording.** The "on recording stop" trigger is the main
fix for the "it didn't upload when I got home" report: a finished paddle is pushed right
away instead of waiting up to 5 minutes. The 5-min retry still matters: a recording that
finishes away from WiFi can't upload then, and the device may not lose power on the way
home. Retries are suppressed while recording — a doomed 15 s WiFi attempt every few
minutes is pure battery cost on the water.

### Uploads never run while recording

Both cores would otherwise touch the SD card at once. The rule stays: **the sync task
does no SD work while a recording is active.** Starting a recording asks the task to
yield and waits briefly for the in-flight file to finish.

### No automatic deletion

The background task **no longer deletes anything**. The card is 256 GB and a session is
a few hundred KB at most, so space is not the constraint; visibility and user control
are. Files accumulate until the user clears them from the Sync screen. (This replaces the
old auto-prune-keeping-newest-5.)

## Storage: timestamped filenames

Sessions are named from wall-clock time so every name is unique for the device's life:

- **Primary:** `track_YYYYMMDD_HHMMSS.csv`, from **GPS time at session start**. Recording
  requires a fix, so GPS date/time is valid at that moment in normal use.
- **RTC is kept in step:** the on-board **PCF8563** (currently unused) is set from GPS on
  the first valid fix after boot, so wall-clock time survives a brief fix loss and is
  available for future uses.
- **Fallback (time genuinely unknown):** `track_n<NNNNNN>.csv`, where `<NNNNNN>` is a
  monotonic counter stored in **NVS** (its own partition — survives an SD reformat), so a
  name is **never reused even with no clock**. This path should be rare, given the
  fix-required rule.

Interactions to preserve:
- **The CSV column names and contents do not change** — `timestamp`, `lat`, `lon`, etc.
  stay exactly as `device-data.md` documents; only the *file name* changes, so the server
  parser is untouched. No `device-data.md` change is required by this spec.
- The upload idempotency key (`deviceId` + filename) in `device-uplink.md` is unchanged
  in shape; unique names simply stop the post-reformat collision. Worth a one-line note
  there, no contract change.
- `uplinkSyncSessions()` orders files by name for its sweep; `YYYYMMDD_HHMMSS` sorts
  chronologically, so ordering is preserved. A mix with the rare `track_n…` fallback
  sorts it ahead of dated files — acceptable, since deletion is now manual and the sweep
  only needs "upload everything not yet confirmed".

## Verification (on hardware — there is no firmware test harness)

Flash with `tools/flash.sh`, read the serial bring-up and the screens:

- Boot shows the spinner, then lands on **Track** once linked; GPS counts climb and the
  uploader runs without being asked.
- **Double-tap** cycles Track → Sync → Nerd → Track.
- A recording on **Track** creates `track_YYYYMMDD_HHMMSS.csv` (confirm the name over
  serial `LS`); a second tap closes it; stopping triggers a sync attempt within seconds.
- **Sync** shows correct `ACTIVITIES / UPLOADED / PENDING`; `tap` forces a sync and the
  numbers move; after a successful upload `UPLOADED` rises.
- **Hold on Sync** → confirm screen; `tap` deletes only confirmed files (`LS` shows `422`
  and un-uploaded files surviving); `double-tap`/timeout cancels.
- Reformat the card, record a new session, confirm the timestamped name **uploads `201`**
  (not `409`) — the collision is gone.
- With no fix forced (bench), confirm the NVS-fallback name is used and still uploads.
- **Hold on Track** still opens Setup.
