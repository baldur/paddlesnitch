#!/usr/bin/env bash
# The tracker's compiler must not fuse multiply-adds in the core: the ESP32-S3
# gcc does in GNU C mode (madd.s/msub.s), and then the tracker's numbers stop
# matching the server's. library.json's build flags turn it off; this compiles
# the core as PlatformIO would (GNU mode, -O2, those flags) and fails on any
# fused instruction. Pass the toolchain's bin folder, or it looks in ~/.platformio.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bin="${1:-$HOME/.platformio/packages/toolchain-xtensa-esp32s3/bin}"
flags=$(python3 -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1]))["build"].get("flags", [])))' "$here/library.json")
obj="$(mktemp -d)/recorder_core.o"
"$bin/xtensa-esp32s3-elf-gcc" -std=gnu17 -O2 -mlongcalls $flags -I"$here/include" -c "$here/src/recorder_core.c" -o "$obj"
fused=$("$bin/xtensa-esp32s3-elf-objdump" -d "$obj" | grep -c -E '\b(madd|msub)\.s\b' || true)
if [ "$fused" -ne 0 ]; then
    echo "FAIL: $fused fused multiply-adds in the ESP32-S3 build (flags: '$flags')"
    exit 1
fi
echo "ok   no fused multiply-adds in the ESP32-S3 build (flags: $flags)"
