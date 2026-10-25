# Testing tracker setup on a real tracker

The app's tracker screen (Paddles → **Tracker**) pairs a tracker, adds it to
your account, gives it WiFi and syncs its recordings over Bluetooth. Every
step is tested against a fake tracker (`app/src/test/.../tracker/`), but not
yet against real hardware. This is the check, about 15 minutes.

## You need

- A tracker on firmware **0.18.0 or later** (Bluetooth). To test linking it
  must be **enrolled** (`firmware/tools/enroll.sh`, from 0.19.1), or the server
  answers "hasn't been registered".
- The Pixel with a debug build: `cd mobile/android && ./gradlew :app:installDebug`
  (or the APK from the PR's CI run). It talks to paddlesnitch.com; nothing new
  is needed on the server.
- To test **Add to my account**, remove the tracker from your account first on
  paddlesnitch.com/devices. Otherwise the app says "This tracker is on your
  account" and skips that step (correct, but untested).
- At least one recording waiting, to test sync. A short walk with the tracker
  recording does it. Turn the tracker's WiFi off (or be out of range), or its
  own WiFi sync uploads it first.
- A log running on the Mac:

  ```
  adb logcat -c && adb logcat -v time PsTracker:V BluetoothGatt:V BluetoothBondStateMachine:V CompanionDeviceManager:V CDM_CompanionDeviceManagerService:V *:S | tee tracker.log
  ```

## Steps

| # | Do | You should see |
|---|---|---|
| 1 | On the tracker: Settings > Network, tap to page 2 (Bluetooth), hold | Tracker: `BLUETOOTH ON`, then `PT-xxx - 0 paired` |
| 2 | In the app, signed in: Paddles → **Tracker** | "Your tracker", the two steps, **Find my tracker** |
| 3 | Press **Find my tracker** | First time only: Android asks to allow **Nearby devices**. Allow. Then the system sheet lists `PT-xxx` |
| 4 | Choose `PT-xxx` | "Connecting to the tracker…", then "Pairing…" with how to pair |
| 5 | Phone shows a "Pair with PT-xxx?" dialog with a 6-digit number; the tracker shows "Pair over Bluetooth?" and the same number. Tap **Pair** on the phone, **hold** on the tracker | Within a few seconds: the tracker's card (recordings waiting, account, firmware, ID) and three sections |
| 6 | **Add to my account** | "Added to your account." Account changes to "On your account". On paddlesnitch.com/devices the tracker is listed |
| 7 | WiFi: type your network with a **wrong** password, **Send WiFi to the tracker** | "Trying the network…" for up to 30 s, then "Couldn’t join: … the password is probably wrong" |
| 8 | Same with the right password | "The tracker joined your WiFi." |
| 9 | **Sync now** | "Asking the tracker what it has…", then "Recording 1 of N · piece k of m", then "N recordings sent." The tracker's Sync screen shows them uploaded; Paddles shows the paddle within a minute |
| 10 | **Sync now** again | "Nothing new to send." |
| 11 | **Done**, then **Tracker** again → **Connect to PT-xxx** | Connects straight away (no sheet, no pairing number), card shows "None waiting" |

Worth trying too, each should say what to do in words:

- Bluetooth off on the phone, then **Find my tracker**: Android asks to turn it
  on; refusing says "Bluetooth is off on this phone."
- Deny **Nearby devices**: the app says why it needs it and offers
  **Open the app’s settings**.
- Tracker's Bluetooth off, **Find my tracker**: the sheet finds nothing; the
  app says how to turn it on.
- Let the 25 s run out at step 5 (don't hold): "Couldn’t pair…" and
  **Try pairing again**.
- Start a recording, then **Sync now**: "The tracker is recording. Stop it first…"
- Walk away mid-sync, come back, **Sync now**: carries on from the piece it
  stopped at (the log shows fewer pieces the second time).

## If something fails

Send back:

1. The step number and exactly what the screen said.
2. `tracker.log` from the command above.
3. The tracker's serial output if it's on a cable (`BLE:` lines), or a photo
   of its screen.
4. Phone: Settings > Connected devices: is `PT-xxx` listed as paired?

Things already known from the website's Bluetooth testing that the app handles
on its own, and the log lines that show them:

- Android refuses the first paired-only read while pairing finishes: the
  log shows a few `NotPaired` reads, then success. Up to ~30 s.
- A read that never answers: `read 04dd0a03: no answer`, then a retry.
- A phone paired before a firmware update keeps the old list of items:
  `layout ... not matched; cache refresh true`, then `discovered ... 6 of 6 items`.
  If it still says fewer than 6, forget `PT-xxx` in the phone's Bluetooth
  settings and set it up again (the app says so too).
- Android's first connection attempt failing (`status 133`) is retried once.
