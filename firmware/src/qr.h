#pragma once
#include <stddef.h>
#include <stdint.h>

// QR rendering for the 128x64 SH1106. One module, so nothing else needs to know
// how QR works.
//
// THE SIZING IS THE WHOLE PROBLEM. The panel is 64 px tall and a QR needs a
// light quiet zone, so:
//
//   version 2 = 25x25 modules + 2-module quiet = 29 -> 58 px at 2 px/module  FITS
//   version 3 = 29x29 modules + 2-module quiet = 33 -> 66 px at 2 px/module  DOES NOT
//
// So version 2 is the budget, and at ECC level L that is exactly **32 bytes** in
// byte mode. Exceed it and the library silently promotes to version 3, which
// overflows the screen. qrFits() exists so that is a checked condition rather
// than a discovered one; it is covered by host tests in test/test_qr.
//
// TWO THINGS THAT WILL NOT BE OBVIOUS FROM A SCREENSHOT:
//
//  1. The quiet zone here is 2 modules, HALF the 4 the QR standard asks for.
//     That is forced by the 64 px height. Most scanners tolerate it; some do
//     not, and it is the most likely reason a code that looks perfect fails at
//     arm's length. If real-phone testing fails, widen the quiet zone before
//     touching anything else -- which means dropping to 1 px/module.
//  2. Scanners expect DARK modules on a LIGHT field and many reject the
//     inverse. On an OLED the natural loop lights the dark modules, which
//     produces exactly the inverted code that fails. qrDraw fills the bounding
//     box and CLEARS set modules. Do not "simplify" that.
#define QR_MAX_PAYLOAD 32

// Would `text` fit in a version-2 code? Always check before building one.
bool qrFits(const char *text);

// Renders `text` at (x, y) into the shared u8g2 buffer, 2 px per module,
// dark-on-light, including the quiet zone. The drawn square is qrSizePx()
// on a side. No-op and returns false if the payload does not fit.
bool qrDraw(const char *text, int x, int y);

// Side length in pixels of what qrDraw() draws, quiet zone included.
int qrSizePx();

// Prints the module grid to Serial as ASCII, '#' for dark. Exists because the
// two failure modes that matter here -- an inverted code, and a payload that
// silently promoted to a version too big for the panel -- are both visible in
// the grid and neither is visible in a photograph of a 58 px square. Serial
// only; draws nothing.
void qrDumpSerial(const char *text);
