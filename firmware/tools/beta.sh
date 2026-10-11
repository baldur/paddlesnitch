#!/usr/bin/env bash
# Which trackers get new firmware first.
#
# A merge releases to the BETA channel; only trackers on this list take it. When
# it has run well on one, flip it to everyone:
#   gh workflow run firmware-release.yml -f version=<v> -f channel=stable
#
# The list is firmware/beta-devices.json in the data bucket, written with your
# AWS login (the web server cannot write under firmware/). The server re-reads it
# within a minute.
#
# Usage: tools/beta.sh list
#        tools/beta.sh add <deviceId>      e.g. 435AC17C (STATUS prints it)
#        tools/beta.sh remove <deviceId>
# Needs: aws sso login --profile paddlesnitch
set -euo pipefail
KEY="s3://paddlesnitch-data-prod/firmware/beta-devices.json"
AWS=(aws --profile paddlesnitch --region eu-west-1)

current() { "${AWS[@]}" s3 cp "$KEY" - 2>/dev/null || echo '{"deviceIds":[]}'; }

case "${1:-list}" in
  list)
    current | jq -r '.deviceIds[]?' ;;
  add|remove)
    ID="$(printf '%s' "${2:-}" | tr 'a-f' 'A-F')"
    printf '%s' "$ID" | grep -Eq '^[0-9A-F]{8}$' || { echo "usage: $0 $1 <8-hex deviceId>" >&2; exit 1; }
    if [ "$1" = add ]; then FILTER='.deviceIds = ((.deviceIds // []) + [$id] | unique)'
    else FILTER='.deviceIds = ((.deviceIds // []) - [$id])'; fi
    current | jq -c --arg id "$ID" "$FILTER" | "${AWS[@]}" s3 cp - "$KEY" --content-type application/json --only-show-errors
    echo "beta trackers now:"; current | jq -r '.deviceIds[]?' ;;
  *) echo "usage: $0 list | add <id> | remove <id>" >&2; exit 1 ;;
esac
