#!/usr/bin/env bash
# Flash the T-Beam S3 Supreme over its native USB.
#
# esptool's DTR/RTS auto-reset does not put this board into download mode: the
# running firmware's USB-CDC stack ignores it. Opening the port at 1200 baud
# does work -- the Arduino core treats it as "reboot to bootloader" -- so do
# that first, wait for the ROM device to re-enumerate, then upload.
#
# Usage: tools/flash.sh [extra pio args...]
set -euo pipefail
cd "$(dirname "$0")/.."

PY="$(ls /opt/homebrew/Cellar/platformio/*/libexec/bin/python 2>/dev/null | head -1)"
[ -n "$PY" ] || PY=python3

echo "==> knocking board into bootloader (1200-baud touch)"
"$PY" - <<'PYEOF'
import glob, time, serial
ports = glob.glob("/dev/cu.usbmodem*")
if not ports:
    raise SystemExit("no /dev/cu.usbmodem* port -- is the board plugged in?")
try:
    s = serial.Serial(ports[0], 1200); s.dtr = False; time.sleep(0.3); s.close()
except Exception as e:
    print("  touch failed (may already be in bootloader):", e)
time.sleep(3)
PYEOF

PORT="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)"
echo "==> uploading via $PORT"
exec pio run -t upload --upload-port "$PORT" "$@"
