# Release testing — tracker firmware

**Status:** ✅ in use from 2026-10-05 (manual bench walk + `tools/bench.sh`).
Later stages (beta channel, hardware in CI, crash alerts) are planned, below.
**Owner:** Baldur.
**Related:** [`device-ota-and-auth.md`](device-ota-and-auth.md) (how releases reach
trackers), [`tracker-bluetooth-sync.md`](tracker-bluetooth-sync.md),
`firmware/CLAUDE.md` § Verifying a change on real hardware.

---

## Why this exists

**Merging firmware to `main` releases it.** The release workflow builds,
publishes and promotes it to every tracker on its next sync. The tracker rolls
itself back only if a new build fails to *start*; a build that starts and then
misbehaves stays.

The web side is well covered (unit tests, browser end-to-end tests on every PR,
a smoke test after each deploy). The firmware side has host tests for its pure
logic, and nothing else runs automatically. In two days in October 2026, every
serious problem was one only real hardware or a real phone could show:

| Problem | Caught by |
|---|---|
| Upload task stack overflow → crash loop on every boot | bench, before release |
| USB serial dropping bytes when the host runs ahead | bench |
| Stray zero byte in a Bluetooth reply → paired phone told "couldn't pair" | phone |
| Android caching the tracker's old Bluetooth item list | phone |
| A Bluetooth read that never answered → page hung | phone |

None of them would have failed a unit test. So each firmware release gets a
short bench walk on a real tracker before it merges, and a check after.

## Who does what

- **Whoever writes the change** (often Claude) runs Part A on a tracker on USB
  and pastes the output into the PR.
- **The owner** does Part B with a phone when the change touches Bluetooth or
  setup, then merges.
- **After merging**, Part C, the same day.

## Setup, once

- **A test tracker on a test account.** Use paddle04 or paddle05, not your own
  tracker: bench runs upload test recordings and re-pair phones. (Until then,
  your own tracker works; the test recordings are 10 minutes long and dated
  when they were made.)
- **Tools:** PlatformIO (`pio`), already used to build. `tools/bench.sh` uses
  PlatformIO's Python, which has pyserial.
- **The fixture** is `firmware/tools/fixtures/`: a 10-minute slice of the
  13 September 2026 reference paddle (track + motion). `bench.sh put-fixture`
  stamps it with the current time, so every run is a new recording, never a
  duplicate.

## Part A — bench, by cable (about 10 minutes)

From `firmware/`, with the tracker on USB. Each `bench.sh` step prints PASS or
FAIL with the evidence; paste the output into the PR.

1. **Host tests:** `pio test -e native` → all pass.
2. **Both builds:** `pio run -e tracker` and `pio run -e tracker-bench` succeed.
   Note the release image size; a big jump deserves a reason.
3. **Flash the bench build:** `tools/flash.sh -e tracker-bench`.
   (The bench build never updates itself, so the build under test stays on.)
4. **Starts cleanly:** `tools/bench.sh status`
   - PASS: starts up, no crash, stack headroom ≥ 7,000 B.
5. **Uploads over WiFi:** `tools/bench.sh put-fixture`, then `tools/bench.sh sync`
   - PASS: both files written; 2 files uploaded; each compressed ≥ 1.5×
     (expect ~4× track, ~2.6× motion); no failed uploads; headroom ≥ 7,000 B.
   - Check the recording appears on **/devices** → the tracker.
6. **Recovers from a crash** (when the change touches start-up, the upload
   task or updates): send `CRASH` over serial (bench build, from 0.18.0), then
   `tools/bench.sh log 40` → `reset=PANIC`, "checking for an update before
   uploading", and a normal sync after.
7. **Leaves the tracker as found:** flash the normal build (`tools/flash.sh`) if
   it should go back to following releases.

## Part B — phone (Bluetooth or setup changes only, about 10 minutes)

Android phone, Chrome, **paddlesnitch.com/devices/bluetooth**.

1. If the tracker's Bluetooth items changed since the phone last paired:
   phone Settings → Bluetooth → **forget PT-xxx**.
2. **CONNECT** → choose PT-xxx → details show (ID, firmware, account).
3. **PAIR** → the same 6-digit number on the phone and the tracker → hold →
   **Paired**. Also once: double-tap to refuse → "Couldn't pair…".
4. **WiFi:** a wrong password → "password is probably wrong"; the right one →
   "joined your WiFi".
5. **SYNC OVER BLUETOOTH** (with a fixture recording waiting:
   `bench.sh put-fixture` just before) → "1 recording sent", and it appears on
   /devices.
6. **ADD TO MY ACCOUNT** (only testable with a tracker not on your account):
   "Added to your account", and it appears on /devices.

## Part C — after merging (same day)

1. **The release ran:** GitHub → Actions → "Firmware build & release" is green
   and the tag `fw/v<VERSION>` exists.
2. **The real update path:** flash a tracker with the *previous* release by cable
   (`git checkout fw/v<previous>`, then `tools/flash.sh`), let it sync, and
   watch it update itself: the tracker shows the release note once, and
   `bench.sh status` reports the new version. This is the path every tracker in
   the field takes; Part A can't test it, because the build isn't published
   until it merges.
3. **Trackers check in:** over the next day, **/devices** shows each tracker on
   the new version ("up to date").

## If a release is bad

- **Roll back:** GitHub → Actions → "Firmware build & release" → **Run
  workflow** → the previous version. Trackers move back on their next sync.
  A later merge never re-promotes a build older than a manual promotion, so
  bump VERSION for the fixed release.
- **A tracker stuck in a crash loop during uploads** (from 0.17.1) checks for an
  update before uploading after a crash, so the rollback still reaches it.
- **A tracker that can't start at all** rolls back to the previous build by
  itself after three failed starts. If it fails before that check, it needs a
  cable.

## What's not automated yet, and the plan

| Step | What | When |
|---|---|---|
| 1 | This checklist + `tools/bench.sh` | ✅ now |
| 2 | Dedicated test tracker on a test account | before testers have trackers |
| 3 | **Beta channel:** choose per tracker whether it follows beta or stable; merges go to beta (your trackers) first; promote to stable by hand or after 24 h without crashes. The server already reads per-channel files; trackers are all told "stable". | before testers have trackers |
| 4 | `bench.sh` gains `crash`, `ota` (update from the previous release) and Bluetooth steps | next |
| 5 | **Hardware in CI:** a Raspberry Pi or old Mac running GitHub's self-hosted runner, with a tracker on USB, runs `bench.sh` on every firmware PR | more than a handful of trackers |
| 6 | **Crash alerts:** trackers report their reset reason when they acknowledge an update; alarm on PANIC after a release | with step 3 |

Bluetooth with a real phone stays manual: headless browsers have no Bluetooth,
and pairing needs a hand on the button. The fake-tracker tests in
`apps/web/src/lib/tracker-ble*.test.ts` and the "Technical details" line on the
test page are what make phone failures quick to diagnose.
