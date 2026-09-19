# Feature spec: firmware OTA — S3 delivery, signalled updates, and rollout telemetry

**Status:** 🚧 spec. **Phase 0 is DONE and shipped** (#256, 2026-09-19) — see
below; it differs from what this note originally proposed. Phases 1–4 unbuilt.
Written 2026-09-19.
**Owner:** Baldur (product).
**Supersedes:** Part 2 of [`device-ota-and-auth.md`](device-ota-and-auth.md), which
sketched the shape. That note's Part 1 (how device auth works today) and its
"what to fix first" ordering still stand and are **prerequisites**, not optional.
**Related:** [`device-uplink.md`](device-uplink.md) (the transport and auth this
reuses), `firmware/docs/device-states-spec.md` (screens and gestures).

---

## Read this before writing any code

**The partition change is the only irreversible-if-missed item.** A device
flashed with a single-slot table can never receive OTA — `Update.h` only writes
app partitions and the partition table itself is not OTA-updatable.

> **This is done for the one existing device (#256).** It is NOT done for the
> four on order. Every new device needs the two-slot table flashed **by cable
> before it is used in anger**; miss it on one and that device is cable-only for
> life. This is the single thing in this note with a deadline.

**Do not claim something is tested when it was only compiled.** This repo's
firmware has no test harness; verification means flashing and reading the serial
bring-up report. Say which it was.

**Phases are sequential and each one ships independently.** Do not start Phase 2
before Phase 1 is verified on hardware.

---

## Why, and the two design choices that shape everything

**Signal, don't probe.** The device already talks to paddlesnitch on a schedule:
sync fires at boot, on recording-stop, on a `sync now` tap, and every 5 minutes
while not recording. Every one of those requests gets a response. So the server
tells the device about new firmware *in responses it was already sending*, and
the device never polls in the steady state. A polling fallback exists only for a
device that has gone a long time without any authenticated exchange.

**Stream to flash, never to the card.** The image is written straight from the
TLS stream into the inactive OTA partition via `Update.writeStream()`. It never
touches the microSD. This is deliberate: the SD and the IMU share one SPI bus and
that bus is the source of this firmware's worst bug class. An OTA that needs the
card would put a multi-megabyte write on the most fragile path in the system.

---

## Phase 0 — repartition · ✅ DONE (#256, 2026-09-19)

Shipped, but **not** as sketched below the line. What actually went in:

```
# Name,   Type, SubType,  Offset,   Size
nvs,      data, nvs,      0x9000,   0x5000
otadata,  data, ota,      0xe000,   0x2000
app0,     app,  ota_0,    0x10000,  0x3F0000     3.9375 MB
app1,     app,  ota_1,    0x400000, 0x3F0000     3.9375 MB
coredump, data, coredump, 0x7F0000, 0x10000
```

Two differences from the original proposal, both deliberate:

- **3.9375 MB slots, not 3 MB.** 3.6× the 1.09 MB binary rather than 2.7×.
  Resizing a slot later also needs a cable, so the headroom was worth taking
  while the cable was already attached.
- **`spiffs` is gone.** It was 1.625 MB and *nothing referenced it* — no SPIFFS,
  LittleFS or FFat anywhere in `src/`. Sessions live on the microSD card, which
  is the point of the card. That dead space became app headroom.

**`nvs` kept its offset and size, and this was verified rather than assumed.**
After reflashing, the device still reported `wifi kruttnet`, `joined yes,
previously` and `claimed yes` — credentials and device token both intact, no
re-onboarding. PlatformIO also rewrites `boot_app0.bin` at `0xe000` on a cable
flash, which resets `otadata`, so a stale pointer into the old layout is not a
hazard on this path.

**Proven, not asserted.** `STATUS` and the boot banner both report live state,
so this is checkable on any device instead of inferred from a config file:

```
ota      running=app0 4032KB  target=app1  -> OTA possible
```

Both lines read `OTA IMPOSSIBLE (no second app slot)` before the change, which
is exactly why they exist.

### Still to do for the four devices on order

Flash the two-slot table **by cable, before each device is used**. There is no
second chance: a partition table cannot be changed over the air.

---

## Phase 1 — server: manifest, presigned URL, and the signal

### 1.1 Storage layout

Firmware artifacts live in the existing data bucket under a prefix that is **not**
publicly readable:

```
firmware/<version>/firmware.bin
firmware/<version>/manifest.json     { version, sha256, sizeBytes, notes, builtAt, gitSha }
firmware/channels/stable.json        { version }          <- the promote pointer
```

`stable.json` is the only thing that decides what devices get. Uploading a build
does not release it; promoting does. See Phase 4.

### 1.2 `GET /api/devices/firmware`

Authenticated with the existing device bearer token (`getDeviceAuth`). Query:
`?current=<semver>`.

- **304 Not Modified** when `current` already equals the channel version, or when
  the client sends a matching `If-None-Match`. No body. This is the common case
  and must be cheap — a single read of `stable.json`, cached.
- **200** with:

```json
{
  "version": "0.10.0",
  "sha256": "<hex>",
  "sizeBytes": 1140528,
  "notes": "Fixes IMU peak window; adds QR onboarding.",
  "url": "https://<bucket>.s3.<region>.amazonaws.com/firmware/0.10.0/firmware.bin?X-Amz-...",
  "expiresInSeconds": 900
}
```

`ETag` on the 200 is the version string, so the device can send `If-None-Match`
on its next request and get a 304 for free.

The presigned URL is generated per request, valid **15 minutes**, GET only, for
that one object. Do not reuse a cached presigned URL across devices — the point of
generating per request is that issuance is the thing being recorded.

**Issuing a 200 writes a record.** See 1.4.

### 1.3 The signal: `X-PS-Firmware`

Every response from a **device-authenticated** route — `/api/devices/sessions`
(all of them, including the per-chunk responses) — carries:

```
X-PS-Firmware: 0.10.0
```

the channel version applicable to that device. Add it in one place in the device
auth middleware so no route can forget it. It costs a header on requests that are
already happening; it is not a new round trip.

The device compares against its compiled `FIRMWARE_VERSION`. Different → set a
pending-update flag in RAM. Same → do nothing, forever, with zero extra requests.

### 1.4 Records

Two records per device per version, both written server-side, both keyed so an
administrator can reconstruct one device's history:

```
firmware-events/<deviceId>/<version>/offered   { at, fromVersion, ip, userAgent }
firmware-events/<deviceId>/<version>/booted    { at, fromVersion, bootOk, resetReason, rolledBack }
```

`offered` is written when a 200 is served. `booted` is written by 1.5.

**TTL: 90 days.** These are troubleshooting records, not an audit trail, and they
are personal data in the sense that they tie a physical device to a user account.
Expire them.

### 1.5 `POST /api/devices/firmware/ack`

Device-authenticated. Body:

```json
{ "version": "0.10.0", "previousVersion": "0.9.0", "bootOk": true,
  "resetReason": "SW_RESET", "rolledBack": false }
```

Writes the `booted` record. Idempotent on `(deviceId, version)` — a device that
retries must not create duplicates. Returns `204`.

### 1.6 Admin access

A single route, `GET /api/admin/devices/:deviceId/firmware-events`, gated on a
**human** admin session (`getAuthUser` plus an admin check — a device token must
not satisfy it). Every access writes its own audit line: who, which device, when.

Do not build a UI for this in Phase 1. A route an administrator can curl is
enough, and the audit line is the part that matters.

---

## Phase 2 — observability

### 2.1 CloudWatch metrics

Emit **EMF (Embedded Metric Format)** log lines from the Lambda. No separate
metrics API calls.

Metrics, all `Count`:

| Metric | Emitted when |
|---|---|
| `FirmwareOfferIssued` | a 200 manifest is served |
| `FirmwareCheckNotModified` | a 304 is served |
| `FirmwareBootConfirmed` | an ack arrives with `bootOk: true` |
| `FirmwareBootFailed` | an ack arrives with `bootOk: false` or `rolledBack: true` |

**Dimensions: `version` and `model` only.** Never `deviceId` — it is unbounded
cardinality and it turns a metrics bill into a per-device tracking system. The
per-device detail lives in the records from 1.4, behind the admin route.

### 2.2 Dashboard

One CloudWatch dashboard, `paddlesnitch-firmware`, with:

- Offers issued vs boots confirmed, by version, over 30 days. The gap between the
  two lines is the rollout's real completion state.
- Boot failures by version. Any non-zero value here is the signal to unpromote.
- A number widget: devices on each version in the last 7 days.

Define it in the existing `infra/` IaC, not by hand in the console.

---

## Phase 3 — firmware

### 3.1 New module: `src/ota.{h,cpp}`

Owned by the **uplink task on core 0**, like every other network operation.
Nothing about OTA runs on core 1. It draws nothing; it publishes into the
existing mutex-guarded `UplinkStatus` and `ui.cpp` renders it.

### 3.2 When the device is allowed to update

All of these must be true. Be conservative; a bricked device on the water is
unrecoverable without a cable.

- A pending-update flag is set (from `X-PS-Firmware`), **or** the fallback probe
  below fired.
- `!storageRecording()` — same rule the uploader already follows.
- WiFi is up and `netcfg.everConnected` is true (this is the home network, not a
  hotspot at a race).
- `boardIsCharging()` **or** `boardBatteryMv() > 3800`.
- This version has not already failed 3 times (see 3.6).

### 3.3 The fallback probe

Only for a device that has had no device-authenticated response for **7 days**
(track `lastServerContactMs` in NVS). Then, and only then, it may call
`GET /api/devices/firmware?current=<v>` with `If-None-Match`, **at most once per
24 hours**. Back off to 72 hours after three consecutive failures.

In the normal case this code path never executes. Log when it does — if it fires
often, the signal in 1.3 is not working and that is the bug to fix.

### 3.4 Download and flash

```
esp_ota_get_next_update_partition(NULL)      -> the inactive slot
Update.begin(sizeBytes, U_FLASH)
Update.writeStream(https stream)             -> 4 KB chunks
Update.end(true)                             -> validates the image
```

- **Verify the sha256 over the stream as it is written**, and abort if it differs
  from the manifest. `Update.end()` checks image structure, not that you got the
  bytes the server meant.
- The presigned URL points at S3, a different host from paddlesnitch.com. TLS must
  still verify against the pinned root in `include/root_ca.h` — S3 chains to
  Amazon Root CA 1, so the existing pin **should** work. Verify this early; if it
  does not, add the correct root rather than reaching for `setInsecure()`.
- `http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS)`.
- Show progress on the OLED: a percentage and a bar, fed the same way the Sync
  screen's `upFile`/`upPart` fields are. A motionless screen during a two-minute
  flash reads as a crash — this firmware has already learned that lesson once.

### 3.5 Power-loss safety

Two layers, because the cheaper one does not cover every case.

**App-level (implement regardless):** before setting the boot partition, write to
NVS `ota_pending = <newVersion>` and `ota_boots = 0`. Early in `setup()`, before
anything else:

- `ota_pending` set and `ota_boots >= 3` → `esp_ota_set_boot_partition()` back to
  the other slot, clear `ota_pending`, record `rolledBack`, reboot.
- `ota_pending` set → increment `ota_boots`, carry on.

On a successful self-check — PMU, display, GPS UART alive, card mounted — clear
`ota_pending` and call `esp_ota_mark_app_valid_cancel_rollback()`. Then send the
ack from 1.5 on the next sync, with `bootOk: true`.

**Bootloader-level:** this only helps if `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`
is set in the prebuilt Arduino bootloader, which it may not be.
**Check whether it is, and report the answer — do not assume either way.** If it
is not enabled, the app-level layer above still covers every failure that reaches
`setup()`; an image that faults before `setup()` would need a cable, and that
limitation should be written down rather than glossed over.

Power lost mid-download is safe by construction: `otadata` is untouched until
`Update.end()` succeeds, so an interrupted download leaves a half-written
inactive slot that is simply never booted. Retry from the start.

### 3.6 Give up rather than loop

Track failures per version in NVS (`ota_fail_<version>`). After 3 failed attempts
at the same version, stop attempting it until the channel offers a *newer* one.
An update that fails forever must not turn into a device that spends every sync
downloading a megabyte.

### 3.7 Telling the user

Two touchpoints, both deliberately small:

- **During:** `Updating 0.10.0` plus a progress bar on the OLED. Button input is
  ignored for the duration; say so on screen.
- **After:** the first boot on a new version shows `Updated to 0.10.0` with the
  one-line `notes` from the manifest underneath, until any button press dismisses
  it. This is the whole point of surfacing it — a user who knows something changed
  can tell you when something breaks.

Also add a line to the device's page in the web app: current version, when it
updated, and the notes. That is where someone will look after noticing a change.

---

## Phase 4 — GitHub Actions

New workflow `.github/workflows/firmware-release.yml`. **Build on merge, release
on a human action** — these are two separate things and conflating them means a
bad commit reaches every device.

**On push to `main` touching `firmware/**`:**

1. `pio run -e tracker`
2. Compute sha256, read the version (see below)
3. Upload `firmware.bin` and `manifest.json` to `firmware/<version>/`
4. Do **not** touch `channels/stable.json`
5. Comment the version and size on the commit

**On `workflow_dispatch` with a version input:**

1. Verify `firmware/<version>/` exists
2. Write `channels/stable.json`
3. Post the release to wherever you want to see it

Use OIDC for AWS credentials, not a long-lived access key in secrets.

**Version is currently a `-DFIRMWARE_VERSION` string literal in
`platformio.ini`,** which will drift from git the first time someone forgets —
and it already has. It has read `0.9.0` across every change merged on
2026-09-19, including several that changed device behaviour.
Make one source of truth: a `firmware/VERSION` file read by both the build flag
and the workflow, and fail the build if `VERSION` is unchanged from the previous
commit on `main` while `firmware/src/**` changed.

---

## Security: what this spec does and does not give you

It does **not** include image signing. The device trusts the manifest because it
arrived over TLS pinned to Amazon Root CA 1 with a bearer token, and trusts the
binary because its sha256 matches that manifest. That is a real improvement over
nothing and it is proportionate to a handful of devices.

The residual risk, stated plainly so it is not discovered later: **anyone who can
write to `channels/stable.json` or to the firmware prefix can run arbitrary code
on every device.** Bucket policy should therefore allow writes only from the
release workflow's OIDC role. Signed images (ESP-IDF supports them without full
secure boot) are the proper fix and belong in a follow-up spec.

The prerequisites from `device-ota-and-auth.md` — keying claims by `deviceId`,
rate-limiting the unauthenticated device endpoints, token expiry and rotation —
become materially more important the day a device accepts remote firmware. Do at
least the first two before promoting anything to `stable`.

---

## Verification

**Phase 0:** flashed; `STATUS` shows token and SSID intact; running partition is
`app0`.

**Phase 1–2:** 304 on a current device; 200 with a working presigned URL on a
stale one; the URL 403s after 15 minutes; both records appear; the admin route
returns them and writes an audit line; a non-admin session gets 403; metrics
appear on the dashboard with no `deviceId` dimension.

**Phase 3, on hardware, each stated separately as verified or not:**

1. Signalled update: server promotes, device picks it up on its next sync
   without any extra request before the signal.
2. Full cycle: download, sha256 verified, flash, reboot, self-check, ack with
   `bootOk: true`, `Updated to X` on screen.
3. **Pull the USB cable mid-download.** Device must boot the old firmware
   unchanged and retry later.
4. **Deliberately ship a broken image** (e.g. one that returns early before the
   self-check) and confirm the app-level rollback fires after 3 boots and the ack
   reports `rolledBack: true`.
5. Battery gate: with no charger and a low cell, no update is attempted.
6. Recording gate: an update is never attempted mid-session.

Item 4 is the one that is tempting to skip and the one that decides whether this
is safe to point at a device that is not on your desk.
