#!/usr/bin/env bash
# Prints the UDID of an iPhone simulator for an iOS version, creating one if
# needed. Used by `make test-app` locally and in CI.
#   scripts/simulator.sh latest   newest installed iOS runtime
#   scripts/simulator.sh 17       newest installed iOS 17.x runtime
set -euo pipefail
want="${1:-latest}"

runtime=$(xcrun simctl list runtimes --json | jq -r --arg want "$want" '
  [.runtimes[] | select(.platform == "iOS" and .isAvailable)
   | select($want == "latest" or (.version | startswith($want + ".")))]
  | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty')
if [[ -z "$runtime" ]]; then
  echo "No iOS $want simulator runtime installed. Install it with:" >&2
  echo "  xcodebuild -downloadPlatform iOS${want:+ -buildVersion <$want.x>}" >&2
  exit 1
fi

udid=$(xcrun simctl list devices --json | jq -r --arg rt "$runtime" '
  [.devices[$rt][]? | select(.isAvailable and (.name | startswith("iPhone")))]
  | first | .udid // empty')
if [[ -z "$udid" ]]; then
  # The newest iPhone this runtime supports.
  type=$(xcrun simctl list runtimes --json | jq -r --arg rt "$runtime" '
    .runtimes[] | select(.identifier == $rt) | [.supportedDeviceTypes[]
    | select(.productFamily == "iPhone")] | last | .identifier')
  udid=$(xcrun simctl create "paddlesnitch-${runtime##*.}" "$type" "$runtime")
fi
echo "$udid"
