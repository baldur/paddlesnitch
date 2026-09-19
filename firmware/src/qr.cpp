#include "qr.h"
#include <string.h>

// The sizing constants are needed by the host tests, which cannot link u8g2 or
// the QR library, so they live above the guard and qrFits() stays pure.
static const int QR_PX   = 2;    // 64 px of panel / 2 = 32 modules to spend
static const int QR_SPAN = 32;   // modules that fit vertically, quiet zone included

// The quiet zone is spent, not fixed. Whatever the chosen version does not use
// of the 32 available modules goes to the border, because a thin quiet zone is
// the single most likely reason a code that looks perfect fails to scan.
//
//   v1  21 modules -> quiet 5 each side  (past the standard 4)
//   v2  25 modules -> quiet 3 each side  (was 2, which was half the standard)
//
// Both land on 62 px, so the drawn square is one size whatever the payload and
// callers need not care which version they got.
static int modulesFor(int version) { return 17 + 4 * version; }
static int quietFor(int version)   { return (QR_SPAN - modulesFor(version)) / 2; }

// Is every character in QR ALPHANUMERIC mode's set? It packs 2 characters per
// 11 bits against byte mode's 8 bits each, so an all-uppercase URL fits a
// version-1 code where the same string in byte mode would not -- 25 characters
// against 17. Lowercase is NOT in the set, which is why the claim link is
// uppercased: domains are case-insensitive, so it costs nothing.
static bool isAlnumQr(const char *t)
{
    for (const char *p = t; *p; p++) {
        const char c = *p;
        if (c >= '0' && c <= '9') continue;
        if (c >= 'A' && c <= 'Z') continue;
        if (strchr(" $%*+-./:", c)) continue;
        return false;
    }
    return true;
}

// Smallest version that holds `text`, or 0 if nothing does.
static int versionFor(const char *text)
{
    if (!text) return 0;
    const size_t n = strlen(text);
    const bool alnum = isAlnumQr(text);
    if (alnum ? (n <= 25) : (n <= 17)) return 1;
    if (alnum ? (n <= 47) : (n <= 32)) return 2;
    return 0;
}

bool qrFits(const char *text) { return versionFor(text) != 0; }

// Both versions land on the same 31 modules once the quiet zone has absorbed
// the slack (v1: 21+10, v2: 25+6), so the drawn square is one size whatever the
// payload. Derived rather than written as 62, because the previous version of
// this line WAS a hand-computed constant and it was wrong by 2 px.
int qrSizePx() { return (modulesFor(2) + 2 * quietFor(2)) * QR_PX; }

#ifdef ARDUINO
#include "board.h"
#include <qrcode.h>

void qrDisplayTune()
{
    // NOT one-shot, and that matters. Every screen calls display.begin() before
    // drawing, u8g2's begin() re-runs the controller's init sequence, and that
    // resets 0xD5 to its default. A `static bool done` guard here -- which is
    // what this had -- applied the setting once and let the very next draw wipe
    // it, so the main anti-banding lever was not actually in effect. Two I2C
    // bytes per draw is nothing; re-assert them.
    //
    // 0xD5: high nibble oscillator frequency, low nibble divide ratio - 1.
    // 0xF0 = fastest oscillator, no division; default 0x80. Frame rate is
    // roughly Fosc / (divide x phases x 64 rows), so this is the one knob that
    // moves the panel's scan rate away from a camera's exposure -- the scan
    // itself cannot be stopped, because only one row of a passive-matrix OLED
    // emits at a time.
    display.sendF("ca", 0xD5, 0xF0);
    display.setContrast(255);
}

bool qrDraw(const char *text, int x, int y, bool invert)
{
    if (!qrFits(text)) return false;
    qrDisplayTune();

    const int version = versionFor(text);
    if (!version) return false;
    const int quiet = quietFor(version);

    QRCode qr;
    uint8_t data[qrcode_getBufferSize(2)];     // sized for the largest we use
    // ECC_LOW because the byte budget is the binding constraint, not damage
    // tolerance -- the screen is clean glass, not a printed label on a boat.
    if (qrcode_initText(&qr, data, version, ECC_LOW, text) < 0) return false;
    if (qr.size != modulesFor(version)) return false;   // refuse rather than overflow

    // Default: light field, then CLEAR the dark modules, giving a scanner the
    // dark-on-light it expects. Inverted: leave the field off and LIGHT the
    // modules -- far fewer emitting pixels, which is the point when a camera is
    // banding on the panel refresh.
    const int side = qrSizePx();
    if (!invert) {
        display.setDrawColor(1);
        display.drawBox(x, y, side, side);
        display.setDrawColor(0);
    } else {
        display.setDrawColor(0);
        display.drawBox(x, y, side, side);
        display.setDrawColor(1);
    }
    for (uint8_t my = 0; my < qr.size; my++) {
        for (uint8_t mx = 0; mx < qr.size; mx++) {
            if (!qrcode_getModule(&qr, mx, my)) continue;
            display.drawBox(x + (quiet + mx) * QR_PX,
                            y + (quiet + my) * QR_PX, QR_PX, QR_PX);
        }
    }
    display.setDrawColor(1);   // leave the context as we found it
    return true;
}

void qrDumpSerial(const char *text)
{
    if (!qrFits(text)) { Serial.printf("QR: %s does not fit 32 bytes\n", text); return; }
    const int version = versionFor(text);
    QRCode qr;
    uint8_t data[qrcode_getBufferSize(2)];
    if (qrcode_initText(&qr, data, version, ECC_LOW, text) < 0) {
        Serial.println("QR: init failed");
        return;
    }
    Serial.printf("<<<QR %s v%d %dx%d quiet=%d %dpx %s>>>\n", text, version, qr.size, qr.size,
                  quietFor(version), qrSizePx(), isAlnumQr(text) ? "alnum" : "byte");
    for (uint8_t y = 0; y < qr.size; y++) {
        for (uint8_t x = 0; x < qr.size; x++) Serial.print(qrcode_getModule(&qr, x, y) ? '#' : '.');
        Serial.println();
    }
    Serial.println("<<<END>>>");
}
#endif
