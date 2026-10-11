#!/usr/bin/env bash
# Enrol a tracker's key with paddlesnitch, so it can be added to an account.
#
# Since 0.19.1 a tracker proves it is itself when it is claimed (it signs with
# its own key; see firmware/CLAUDE.md, "Claiming needs the tracker's key"), and
# the server refuses a tracker whose key it doesn't know. Run this once per
# tracker, after flashing it, with it plugged in. Re-running replaces the key --
# a cable is the only thing allowed to, because it means you hold the tracker.
#
# Writes device-keys/<ID>.json to the data bucket with your AWS login, for the
# ID the tracker uses now and its unique ID (what it becomes after a factory
# reset). Trackers already on an account register their key themselves on the
# next sync, so this is needed for new trackers, and after a full flash erase.
#
# Usage: tools/enroll.sh             production (needs: aws sso login --profile paddlesnitch)
#        tools/enroll.sh --local     your local dev data (apps/web/.local-data)
set -euo pipefail
cd "$(dirname "$0")/.."

PY="$(ls /opt/homebrew/Cellar/platformio/*/libexec/bin/python 2>/dev/null | head -1)"
[ -n "$PY" ] || PY=python3

echo "==> asking the tracker for its key (it restarts when the port opens; ~25 s)"
LINES="$("$PY" tools/enroll.py)"

while IFS=$'\t' read -r ID REC; do
  if [ "${1:-}" = "--local" ]; then
    DIR="../apps/web/.local-data/device-keys"; mkdir -p "$DIR"
    printf '%s' "$REC" > "$DIR/$ID.json"
    echo "    enrolled $ID (local)"
  else
    printf '%s' "$REC" | aws s3 cp - "s3://paddlesnitch-data-prod/device-keys/$ID.json" \
      --content-type application/json --profile paddlesnitch --region eu-west-1 --only-show-errors
    echo "    enrolled $ID"
  fi
done <<< "$LINES"
echo "==> done. This tracker can now be added to an account."
