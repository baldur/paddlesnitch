# Design note: device OTA, and how solid the device auth actually is

🚧 **Not built.** Written 2026-09-17; updated the same day once it became clear
several devices are planned, which changes the conclusion. Two separate questions
that turn out to be one, because OTA is only as safe as the thing that authorises it.

> **The one thing that is time-critical.** The partition table cannot be changed
> over the air — it lives outside the app slots and `Update.h` only writes app
> partitions. So **every device flashed with today's single-slot table is
> permanently cable-only**, and no amount of later work will retrofit OTA onto it.
> The repartition is a ten-minute job that must happen *before* a device leaves
> your hands. Everything else in this note can wait; this cannot.

---

## Part 1 — How the server authenticates a device today

### The flow

```
device  POST /api/devices/claim   {deviceId, model, firmware}
        → 6-char claimCode (shown on the OLED) + 32-byte claimSecret (kept)
user    enters the code at /profile/me/settings while signed in
        → the claim record gains a userId
device  POST /api/devices/token   {deviceId, claimSecret}   (polls)
        → 32-byte deviceToken, once
device  Authorization: Bearer <deviceToken>  on every upload
```

### What it gets right

- **Nothing reusable is stored.** The claim secret and the device token are kept
  only as `sha256`. The token record is *keyed by* the hash, so a read of the data
  bucket yields hashes of 32 random bytes — not brute-forceable, not replayable.
- **Constant-time comparison** of the claim secret (`hexEqual` → `timingSafeEqual`).
- **Claims are single-use and expire** (10 min), with a consumed *tombstone* so a
  repeat poll gets `410` rather than a misleading "pending".
- **Failures are indistinguishable.** A wrong `deviceId` or secret returns
  `pending`, exactly like a claim that hasn't been approved yet, so the endpoint
  can't be used to probe which device IDs exist.
- **No shared secret in the firmware.** Every device gets its own revocable token,
  so extracting one binary doesn't yield a key to all devices.
- **TLS against a pinned root** (Amazon Root CA 1, `include/root_ca.h`), not
  `setInsecure()` — a rogue CA can't MITM the upload.
- **Device and human auth are separate** (`getDeviceAuth` vs `getAuthUser`): a
  device token cannot satisfy a browser route, or vice versa.

That is a sound design for what it is. The weaknesses below are mostly about what
happens *after* a token exists, and they matter more once OTA is in the picture.

### What it doesn't get right

**1. Tokens never expire and never rotate.** `DeviceTokenRecord` has `createdAt`
and `lastSeenAt`, and nothing reads them for expiry. A token leaked once is valid
until somebody notices and revokes it by hand.

**2. The token sits in plaintext NVS, and there is no flash encryption.** Physical
access to the board → read the flash → recover the token → upload arbitrary
sessions to that user's account. Severity is low (the blast radius is "junk
paddles appear in one account"), but it is unbounded in time because of (1).

**3. `POST /api/devices/claim` is unauthenticated and unthrottled.** Anyone can
mint claim codes for any `deviceId`. Two consequences:
   - *Storage/DoS:* unbounded claim records, and `redeemToken` **lists and reads
     every claim** on each poll (`listKeys('device-claims/')`), so the cost of a
     poll grows with the number of outstanding claims. This is the one I'd fix
     first, and it is a performance bug before it is a security one — the fix is
     to key claims by `deviceId` so redemption is a direct read.
   - *Claim-code phishing:* an attacker mints a code and persuades a user to type
     it. The user's account then binds an attacker-controlled "device". The
     existing mitigation is social — the code is shown on the device's own screen,
     so a user should only ever type a code they can physically see — and that is
     worth saying in the UI rather than leaving implicit.

**4. Rate limiting is deferred** (already recorded in CLAUDE.md). The two device
endpoints are unauthenticated, which is exactly where a limit belongs.

**5. `resolveDeviceToken` writes on every request** to update `lastSeenAt`. Not a
security issue; a write per API call is worth knowing about before traffic grows.

### Honest summary

For "a hobby tracker uploads GPS traces to one account", the current scheme is
proportionate and the cryptographic hygiene is genuinely good. The gaps that
matter are **non-expiring tokens** and **an unauthenticated, unthrottled, O(n)
claim endpoint**. Neither is urgent. Both become materially more serious the day
the device accepts remote firmware.

---

## Part 2 — OTA

### The blocker nobody will expect

`firmware/partitions.csv` has `otadata` and `app0 (ota_0)` — but **no `app1`**.
There is one app slot, so the ESP32's OTA machinery cannot do anything: an A/B
update needs two.

Current app size is ~1.08 MB in a 6.25 MB slot, so there is plenty of room to
repartition an 8 MB flash:

```
nvs,      data, nvs,      0x9000,   0x5000
otadata,  data, ota,      0xe000,   0x2000
app0,     app,  ota_0,    0x10000,  0x300000     3 MB
app1,     app,  ota_1,    0x310000, 0x300000     3 MB
spiffs,   data, spiffs,   0x610000, 0x1E0000
coredump, data, coredump, 0x7f0000, 0x10000
```

3 MB per slot is ~2.7× the current binary — room for TLS, BLE, whatever comes.

**`nvs` stays at the same offset and size**, so WiFi credentials and the device
token *should* survive the repartition. Verify rather than assume: a full-erase
flash would wipe them and force re-onboarding, which on a device whose whole point
is not needing a laptop is a bad surprise.

### Shape of the implementation

1. **Repartition** (above), flash once over the wire. One-time cost, requires
   physical access — which is the point at which to also decide about (2).
2. **Sign the images.** OTA without signature verification means anything that can
   answer the device's update request can run arbitrary code on it, which is a far
   worse position than the device is in today. ESP-IDF supports signed app images
   without full secure boot; that is the minimum bar.
3. **A manifest endpoint**, authenticated with the existing device token:
   `GET /api/devices/firmware?current=0.7.0` → `{version, url, sha256, sig}` or
   `204`. Reuses the auth that already exists, and gives the server the ability to
   stage a rollout (by device, by percentage) rather than all-or-nothing.
4. **Download and verify, then flash**, using `Update.h`. Verify the hash and
   signature *before* marking the new slot bootable.
5. **Boot, self-check, confirm.** Mark the image valid only after a successful
   boot that reaches a known-good state (display up, card mounted). Otherwise the
   bootloader rolls back to the previous slot on the next reset. This is the whole
   reason A/B is worth the flash space, and today's boot loop is the argument: an
   update that bricks the device in the field is unrecoverable without a cable.
6. **Never update while recording.** Same rule the uploader already follows.

### What to fix first, if OTA is ever going ahead

In this order, because each one is a prerequisite for the next being worth doing:

1. Key claims by `deviceId` (kills the O(n) scan).
2. Rate-limit the two unauthenticated device endpoints.
3. Expiry + rotation for device tokens.
4. Signed images.
5. Repartition + A/B.

Steps 1–3 are worth doing on their own merits whether or not OTA happens.

**But step 5's partition change jumps the queue for any device being built or
handed over**, because it is the only item on this list that stops being possible
later. Ship a device on the current table and it is cable-only for life. Flash the
two-slot table from the start and every other step stays open, in whatever order
and whenever they are actually needed — the empty `app1` slot costs nothing but
3 MB of a flash that is 83% unused.

---

## Open questions

- **Is OTA actually worth it?** With one device on a cable, no — a flash takes 13
  seconds. With several in other people's hands, yes, and that is now the stated
  direction. The thing to separate is the *mechanism* from the *prerequisite*: the
  mechanism can wait until there is something to update and someone to update it
  for; the repartition cannot wait past the first device you hand over. Do the
  cheap irreversible-if-missed part now, build the rest when it is needed.
- **Flash encryption and secure boot?** They close the physical-access hole, and
  they make a bricked device genuinely unrecoverable if the keys are mishandled.
  Not for a single hand-built unit.
- **Should the claim UI say "only type a code you can see on your own device"?**
  Cheap, and it is the actual mitigation for claim-code phishing.
