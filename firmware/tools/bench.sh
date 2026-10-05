#!/usr/bin/env bash
# Bench checks for a tracker on USB. See tools/bench.py and
# docs/features/release-testing.md. Uses PlatformIO's Python, which already
# has pyserial (the same one tools/flash.sh uses).
set -euo pipefail
cd "$(dirname "$0")/.."
PY="$(ls /opt/homebrew/Cellar/platformio/*/libexec/bin/python 2>/dev/null | head -1)"
[ -n "$PY" ] || PY=python3
exec "$PY" tools/bench.py "$@"
