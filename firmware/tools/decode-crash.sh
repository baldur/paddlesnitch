#!/usr/bin/env bash
# Turn a tracker crash report's addresses into function, file and line.
#
#   tools/decode-crash.sh <version> <address...>
#   tools/decode-crash.sh 0.18.0 0x42011ebb 0x42012f9f 0x4201463d
#
# The addresses come from the crash report (the DeviceCrash log line, or
# devices/<id>/crashes/ in the data bucket: pc + bt). They only mean something
# against the exact build that crashed: the release workflow keeps that build's
# firmware.elf in s3://<data bucket>/firmware/<version>/ (from 0.18.0). Older
# versions are rebuilt from their tag, fw/v<version>, which gives the same
# addresses when the toolchain hasn't changed.
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 2 ] || { sed -n '2,13p' "$0"; exit 1; }
V="$1"; shift
A2L="$(ls ~/.platformio/packages/toolchain-xtensa-esp32s3/bin/xtensa-esp32s3-elf-addr2line)"
ELF="$(mktemp -d)/firmware.elf"
BUCKET="${DATA_BUCKET:-paddlesnitch-data-prod}"
if aws s3 cp "s3://$BUCKET/firmware/$V/firmware.elf" "$ELF" --quiet --profile "${AWS_PROFILE:-paddlesnitch}" 2>/dev/null; then
  echo "==> using the released build's firmware.elf ($V)"
else
  echo "==> no stored firmware.elf for $V; rebuilding from tag fw/v$V"
  WT="$(mktemp -d)/fw"
  git worktree add -q --detach "$WT" "fw/v$V"
  (cd "$WT/firmware" && pio run -e tracker >/dev/null)
  cp "$WT/firmware/.pio/build/tracker/firmware.elf" "$ELF"
  git worktree remove --force "$WT"
fi
"$A2L" -pfiaC -e "$ELF" "$@"
