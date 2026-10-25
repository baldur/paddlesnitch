# fixtures/tracker

The tracker's Bluetooth protocol, as both phone apps must speak it. Derived
from the firmware and the website, which already speak it to each other
(docs/features/tracker-bluetooth-sync.md). `pnpm test`
(`apps/web/src/lib/tracker-ble.fixtures.test.ts`) checks every file here
against the firmware header and the website's own parsers, so a change on
either side that these don't follow fails there first.

| File | What | Source |
|---|---|---|
| `gatt.json` | Service and characteristic UUIDs, which need a paired connection, the layout string, the `PT-` name prefix, page and piece sizes, WiFi limits, and the waits | `firmware/include/ble_about.h` (`PS_BLE_*_UUID`, `PS_BLE_PAGE_DATA`); `firmware/src/ble.cpp` (`BLE_LAYOUT`, properties in `bleStart`, `WifiCallbacks` limits, the name from `apSsidFor`); `firmware/src/uplink.cpp` (`UPLOAD_CHUNK`); `apps/web/src/lib/tracker-ble.ts` (`PAIRING_WAIT`, `WIFI_WAIT`, `SYNC_WAIT`) |
| `replies.json` | What reading each item returns (`raw`, exactly the bytes as UTF-8) and what it means (`out`; `null` = refuse it) | `bleAboutJson`, `PS_BLE_PAIRED_JSON`, `bleLinkJson`, `bleWifiJson`, `bleSyncJson` in `ble_about.h`; the list from `btBuildList` in `uplink.cpp`; the strings `firmware/test/test_ble_about` expects; parsed as `parseAbout`, `isPairedReply`, `parseLinkStatus`, `parseWifiState`, `parseSyncStatus`, `parsePendingList` do |
| `commands.json` | The JSON each write sends (key order doesn't matter; the firmware parses it with ArduinoJson) | `LinkCallbacks`, `WifiCallbacks`, `SyncCallbacks`, `DataCallbacks` in `ble.cpp` |
| `pages.json` | A DATA page: 4-byte offset, little-endian, then up to 500 bytes | `blePageHeader` / `uplinkBtPage` |
| `receipt.json` | The receipt the server hands back for a relayed upload: HMAC-SHA256, keyed with the **hex** sha256 of the tracker's token (as ASCII), over `ps-receipt:v1|<deviceId>|<upload name>` | `uploadReceipt` in `packages/core/src/devices.ts`; `bleReceiptMessage` in `ble_about.h` |

## Rules the replies carry

- A value may end with a zero byte (a C string's terminator) or whitespace:
  trim it before parsing JSON.
- `v` must be `1`; anything else is a shape this app doesn't know.
- A tracker id is 8 uppercase hex characters.
- `waiting: null` means "not counted yet", not "nothing waiting".
- A list entry is dropped unless `n` and `u` are plain file names
  (`[\w.-]{1,64}`, not starting with `.`) and `s` is a number.

## How a session goes

1. Connect, read **About** (open to anyone in range).
2. Read **Paired**. The first read is refused until the link is encrypted,
   and that refusal is what starts pairing (a 6-digit number on both screens;
   hold the tracker's button). Retry: `waits.pairing` tries, each read given
   `readTimeoutMs` (on Android a read can hang), `delayMs` apart.
3. **Link**: write `linkBegin`, read Link (`pending` with `tokenHash` + `sig`),
   `POST /api/account/devices/link-bluetooth {deviceId, tokenHash, signature, model, firmware}`
   as the user, then write `linkCommit` with that hash and read Link until
   `committed`. The token stays on the tracker.
4. **WiFi**: write `{ssid, pass}`, read WiFi every `delayMs` until it leaves
   `idle`/`trying`.
5. **Sync**: write `syncList`, read Sync until `ready`, read `len` bytes off
   DATA (seek back with `dataSeek` when a page's offset isn't where you are);
   for each recording, `GET /api/account/devices/<id>/sessions?filename=<u>`
   says which pieces the server already has; ask for each piece, read it,
   `POST …/sessions?filename=<u>&part=p&parts=n[&enc=zlib]` (202 until the
   last; 201, or 409 `already_uploaded`, carries `receipt`), then write
   `syncDone` with that receipt and read Sync until `marked` or `bad_receipt`.
   The last piece always goes, even if the server has it. `busy` = the tracker
   is recording; stop.
