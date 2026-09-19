# Feature spec: QR onboarding — scan to join, scan to link

**Status:** Phase 1 **built, not verified with a phone**. Phase 2 not started.
Spec written 2026-09-19; Phase 1 implemented the same day.
**Owner:** Baldur (product).
**Related:** `firmware/src/netcfg.cpp` (the portal), `firmware/src/qr.{h,cpp}`,
[`device-ota-and-auth.md`](device-ota-and-auth.md) (the claim flow this shortens),
`firmware/docs/device-states-spec.md` (screens and gestures).

---

## Read this before writing any code

**The QR sizing arithmetic is tight and it is the thing most likely to be got
wrong.** Section 1.1 gives the module budgets. Render and photograph the real
screen with a real phone before declaring any of it done — a QR that "looks
right" in a screen preview and fails at 15 cm in daylight is the expected failure
mode, not an unlikely one.

**Do not claim something is tested when it was only compiled.**

> **This already happened once, in the spec itself.** Section 1.2 gave the
> formula `"PT-" + netDeviceId().substring(4)` beside an example payload using
> `PT-A48`. The device id is eight characters, so the formula yields `PT-CA48`
> and a **33-byte payload — one over budget**. The formula and the example in
> the same paragraph disagreed. The implementation uses `substring(5)`, and
> `test/test_qr` pins both forms so the one-character difference cannot come
> back silently.

---

## Why

Setup today has three handoffs. The user reads an SSID off a 128×64 OLED, joins
it, fills a form, gets bounced by `ESP.restart()` back to the OLED, then reads a
six-character claim code off that same OLED, walks to a laptop, signs in,
navigates to profile → settings, and types the code. Two of those steps exist
only because a tiny screen is the only output channel.

A QR code turns each of them into pointing a camera.

---

## Phase 1 — QR on the OLED · BUILT

### 1.1 The constraint that decides the payloads

SH1106 at `0x3D`, 128 visible columns × 64 rows. At 2 px per module:

| QR version | Modules | +2-module quiet zone | Pixels at 2 px | Fits 64 px? |
|---|---|---|---|---|
| 2 | 25×25 | 29×29 | 58 | yes |
| 3 | 29×29 | 33×33 | 66 | **no** |

So **version 2 at ECC level L, which holds 32 bytes**, is the budget.

Implemented in `src/qr.{h,cpp}`. `qrFits()` is a checked precondition rather
than a comment, and both screens fall back to text when a payload is over
budget — so the failure is a plain text screen, never an overflowing or
unreadable code. Covered by `firmware/test/test_qr`, which runs on the host in
half a second via `pio test -e native`.

**Two module-level notes carried into the code:**

- The quiet zone is **2 modules, half the standard 4**, forced by the 64 px
  height. Most scanners tolerate it, some do not, and this is the most likely
  reason a code that looks perfect fails at arm's length. If phone testing
  fails, widen the quiet zone before touching anything else — which means
  dropping to 1 px/module.
- Drawn **dark-on-light**: the bounding box is filled lit and set modules are
  cleared. The natural loop does the opposite and produces an inverted code that
  many scanners reject.

Library: `ricmoo/QRCode` in `lib_deps`.

### 1.2 QR 1 — join the AP

```
WIFI:S:PT-A48;T:WPA;P:<8 chars>;;
```

32 bytes exactly. **Both changes the spec required are in:**

- **AP name shortened** from `PaddleTracker-A48` to `PT-A48` — `"PT-" +
  netDeviceId().substring(5)`, three hex characters (4096 values; the only
  collision that matters is two devices in setup mode in one room).
- **AP has a password**: 8 characters from `esp_random()` on first use, stored
  in NVS under the existing `paddle` namespace as `apkey`. Not derived from the
  MAC — the SSID already carries part of it, so a MAC-derived key would be
  computable by anyone who can see the network name. Alphabet excludes
  `l/o/0/1`, since this gets read aloud off a screen.

### 1.3 QR 2 — enter the claim code

```
paddlesnitch.com/l/ABC123
```

25 bytes. No `https://` — with it the payload is 33 bytes and **does not fit**,
so the scheme is not a nicety that was dropped for neatness. `test_qr` pins that.

Server side: `GET /l/:code` (`apps/web/src/app/l/[code]/route.ts`) normalises the
code and redirects to `/profile/me/settings?code=…#devices`. `DevicesSection`
prefills from `?code=` with a lazy `useState` initialiser — never an effect, per
the repo rule about `useSearchParams` and state.

**Sign-in round trip: this needed a proxy fix.** `src/proxy.ts` set
`next` to the *pathname only* while the cloned URL kept the original query, so
`/profile/me/settings?code=ABC123` became
`/att/auth?code=ABC123&next=/profile/me/settings` and the code was dropped on the
way back. Fixed to carry `pathname + search`, with a regression test in
`proxy.test.ts`. This affected every gated page with a query string, not just QR.

**Text fallback:** the spec called for alternating every 3 s because "the QR
fills the screen". It does not — 58 px on a 128 px panel leaves 70 px, which is
14 characters at 5×8. So the QR is on the **left and the text permanently on the
right**, both visible at once. Strictly better: nobody without a camera has to
wait for the characters to come back round.

### 1.4 Screens affected

- `netcfg.cpp` — new `screenJoinQr()` replaces the four-line `screen(...)` call.
- `uplink.cpp:showCode()` — QR beside the code.

Both still draw in place rather than moving into `ui.cpp`. **Flagging rather
than doing silently, as the spec asked:** the repo rule is that tracker logic
does not touch pixels, and these two are the existing exceptions. Moving them is
a reasonable follow-up but it is a refactor of working code in a change that is
already large, and `ui.cpp` renders from a `UiState` snapshot that neither of
these paths produces.

---

## Phase 2 — keep the portal alive through connect and claim

**Not started, and deliberately so:** the spec says not to begin until Phase 1 is
verified on hardware, and it is not — see below.

*(Phase 2 design retained from the original spec.)*

Today `/save` renders "Saved", then `netBringUp()` calls `ESP.restart()`. The
device is already in `WIFI_AP_STA`, so change `/save` to store credentials and
return a page that polls `GET /status` → `connecting` / `failed` with the reason
`netConnect()` already produces / `claiming` with the code as a tappable link /
`linked`, then restart.

**Watch the AP channel.** The SoftAP is forced onto the station's channel once
the station associates, dropping connected AP clients. The polling page must
treat a failed `/status` fetch as "keep trying", not an error.

---

## Non-goals

- **BLE provisioning** — no Web Bluetooth in Safari on iOS.
- **mDNS** — the DNS server already answers `*`, and the QR makes the address bar
  irrelevant.
- **Changing the claim protocol** — the two-step code-plus-secret flow is
  untouched; only how the code gets from screen to browser has changed.

---

## Verification

### What has been verified

- `pio test -e native` — 9/9, including that both payloads fit version 2, that
  `PT-CA48` and the `https://` form do **not**, and that the square is 58 px.
- `QRDUMP <text>` over serial prints the module grid; both payloads render
  **v2, 25×25**, with finder patterns in three corners — so neither silently
  promotes to a version that would overflow the panel.
- `pio run` clean on all environments; `pnpm test` 773 passing; `pnpm build`
  clean with `/l/[code]` registered.

### Verified on hardware with a phone, 2026-09-19

The **join** half works end to end. Portal opened with `SETUP`, and the serial
log is the evidence:

```
Portal: join WiFi "PT-A48" pass "cn7eyvh9" then open http://192.168.4.1/
Portal: 0 device(s) joined the AP -- waiting
Portal: 1 device(s) joined the AP        <- phone joined, from the QR
Portal: served the form                  <- captive portal fired
saved -- restarting
```

Device came back on the chosen network, still claimed, 8/8 sessions uploaded.
That covers spec items 2, 3, 5 and 6: the code scans **consistently**, the phone
joins without typing, the captive portal still fires, and the text beside it
stays legible.

Getting there took three fixes that are worth recording, because each looked
like "the QR does not work":

- The quiet zone was 2 modules (half the standard). It is now spent from
  whatever the version leaves over — 3 for v2, 5 for v1.
- The display-clock tune that reduces camera banding was applied **once** and
  then wiped, because every screen calls `display.begin()` and u8g2's `begin()`
  re-runs the controller init. It is re-asserted on every draw now.
- `QRTEST` encoded a network that **was not on the air** — it only draws a code;
  `WiFi.softAP()` lives inside `netStartPortal()`. A phone read it, hunted for
  `PT-A48`, found nothing and gave up silently, which is indistinguishable from
  a bad code. It now uses the real credentials and says when the AP is down.

### Still not verified

1. `FORGET`, reboot, portal opens automatically.
4. **Scanning QR 2 opens the link page with the code prefilled.** This is the
   remaining half and it needs a `FORGET`, because the claim screen only appears
   on an unclaimed device. The code itself is in better shape than the join one
   — uppercase makes it alphanumeric, so it is **version 1: 21 modules with a
   5-module quiet zone** against the join code's 25 and 3.
7. A device already set up is unaffected: no portal, no behaviour change.
8. Android — everything above was one phone. The join QR is a standard `WIFI:`
   payload so there is no reason to expect trouble, but it is untested.

Note that (1) clears the WiFi credentials, so it should be done when there is
time to complete setup. The device token is a separate NVS key and survives, so
pairing is not lost.
