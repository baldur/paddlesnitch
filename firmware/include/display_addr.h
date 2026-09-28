#pragma once
#include <stdint.h>

// Which I2C address the OLED is at. Two board batches disagree:
//   - the first tracker (5A43CA48): panel at 0x3D; something that is NOT the
//     panel also acks at 0x3C (driving it gives a blank screen, no error);
//   - the 2026-09 batch (paddle02, 5C43CA48 on): panel at 0x3C, nothing at 0x3D.
// So prefer 0x3D whenever it acks, and fall back to 0x3C only when 0x3D is
// silent. Returns 0 when neither acks. Pure, so the native tests cover it.
static inline uint8_t displayAddressFor(bool acks3D, bool acks3C)
{
    if (acks3D) return 0x3D;
    if (acks3C) return 0x3C;
    return 0;
}
