#include "qr.h"
#include <string.h>

// The sizing constants are needed by the host tests, which cannot link u8g2 or
// the QR library, so they live above the guard and qrFits() stays pure.
static const int QR_VERSION   = 2;
static const int QR_MODULES   = 17 + 4 * QR_VERSION;   // 25 for version 2
static const int QR_QUIET     = 2;                     // half the standard; see qr.h
static const int QR_PX        = 2;

bool qrFits(const char *text)
{
    return text && strlen(text) <= QR_MAX_PAYLOAD;
}

int qrSizePx() { return (QR_MODULES + 2 * QR_QUIET) * QR_PX; }

#ifdef ARDUINO
#include "board.h"
#include <qrcode.h>

bool qrDraw(const char *text, int x, int y)
{
    if (!qrFits(text)) return false;

    QRCode qr;
    uint8_t data[qrcode_getBufferSize(QR_VERSION)];
    // ECC_LOW because the byte budget is the binding constraint, not damage
    // tolerance -- the screen is clean glass, not a printed label on a boat.
    if (qrcode_initText(&qr, data, QR_VERSION, ECC_LOW, text) < 0) return false;
    if (qr.size != QR_MODULES) return false;   // promoted version: refuse rather than overflow

    // Light field first, then CLEAR the dark modules. Inverted is the failure
    // that looks fine on the bench and is rejected by half the scanners.
    const int side = qrSizePx();
    display.setDrawColor(1);
    display.drawBox(x, y, side, side);
    display.setDrawColor(0);
    for (uint8_t my = 0; my < qr.size; my++) {
        for (uint8_t mx = 0; mx < qr.size; mx++) {
            if (!qrcode_getModule(&qr, mx, my)) continue;
            display.drawBox(x + (QR_QUIET + mx) * QR_PX,
                            y + (QR_QUIET + my) * QR_PX, QR_PX, QR_PX);
        }
    }
    display.setDrawColor(1);   // leave the context as we found it
    return true;
}

void qrDumpSerial(const char *text)
{
    if (!qrFits(text)) { Serial.printf("QR: %s does not fit 32 bytes\n", text); return; }
    QRCode qr;
    uint8_t data[qrcode_getBufferSize(QR_VERSION)];
    if (qrcode_initText(&qr, data, QR_VERSION, ECC_LOW, text) < 0) {
        Serial.println("QR: init failed");
        return;
    }
    Serial.printf("<<<QR %s v%d %dx%d %dpx>>>\n", text, QR_VERSION, qr.size, qr.size, qrSizePx());
    for (uint8_t y = 0; y < qr.size; y++) {
        for (uint8_t x = 0; x < qr.size; x++) Serial.print(qrcode_getModule(&qr, x, y) ? '#' : '.');
        Serial.println();
    }
    Serial.println("<<<END>>>");
}
#endif
