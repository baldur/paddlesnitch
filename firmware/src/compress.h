#pragma once
#include <stddef.h>
#include <stdint.h>

// zlib-compress one upload piece with the deflate compressor built into the
// ESP32-S3 ROM (miniz tdefl), so no library is linked in. Returns the
// compressed length, or 0 if compression failed or `out` was too small.
// Whether to actually send it compressed is sendCompressed() in upload_policy.h.
//
// The compressor's work area (~160 KB) is allocated in PSRAM on first use and
// kept: an upload compresses dozens of pieces back to back.
size_t compressPiece(const uint8_t *in, size_t len, uint8_t *out, size_t outCap);
