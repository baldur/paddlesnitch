#include "compress.h"
#include <Arduino.h>
#include "esp32s3/rom/miniz.h"

static tdefl_compressor *s_comp = nullptr;

size_t compressPiece(const uint8_t *in, size_t len, uint8_t *out, size_t outCap)
{
    if (!s_comp) {
        s_comp = (tdefl_compressor *)ps_malloc(sizeof(tdefl_compressor));
        if (!s_comp) return 0;
    }
    // 128 probes is miniz's default level. TDEFL_WRITE_ZLIB_HEADER gives the
    // zlib framing (header + Adler-32) the server's inflate expects.
    if (tdefl_init(s_comp, nullptr, nullptr, 128 | TDEFL_WRITE_ZLIB_HEADER) != TDEFL_STATUS_OKAY) return 0;
    size_t inSize = len, outSize = outCap;
    const tdefl_status st = tdefl_compress(s_comp, in, &inSize, out, &outSize, TDEFL_FINISH);
    // DONE means every input byte was consumed and the stream finished inside
    // `out`. Anything else (out too small, an error) is a plain upload instead.
    if (st != TDEFL_STATUS_DONE || inSize != len) return 0;
    return outSize;
}
