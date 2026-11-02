#!/usr/bin/env bash
# Prints the UDID of an iPhone simulator for an iOS version, creating one if
# needed. Used by `make test-app` locally and in CI.
#   scripts/simulator.sh latest   newest installed iOS runtime
#   scripts/simulator.sh 17       newest installed iOS 17.x runtime
#   scripts/simulator.sh 17 tests a simulator only the app tests use
#                                 ("paddlesnitch-tests-…"), so a setting they
#                                 change never reaches one used by hand
#
# Prefers a standard iPhone ("iPhone 17"): some runtimes are built for one new
# model only (iOS 27.1 24A94425 runs just the foldable), and tests should run
# on the phone most people have.
set -euo pipefail
want="${1:-latest}"
tests="${2:-}"

# "runtime-id device-type-id" for the newest matching runtime, choosing its
# newest standard iPhone, else its newest iPhone of any kind.
pick=$(xcrun simctl list runtimes --json | jq -r --arg want "$want" '
  [.runtimes[] | select(.platform == "iOS" and .isAvailable)
   | select($want == "latest" or (.version | startswith($want + ".")))
   | {id: .identifier, version: (.version | split(".") | map(tonumber)),
      phones: [.supportedDeviceTypes[] | select(.productFamily == "iPhone")]}
   | select(.phones | length > 0)
   | .standard = ([.phones[] | select(.name | test("^iPhone [0-9]+$"))]
                  | sort_by(.name | ltrimstr("iPhone ") | tonumber))
   | .type = ((.standard | last) // (.phones | last))
   | .rank = (if (.standard | length) > 0 then 1 else 0 end)]
  | sort_by(.rank, .version) | last
  | if . == null then empty else "\(.id) \(.type.identifier)" end')
if [[ -z "$pick" ]]; then
  echo "No iOS $want simulator runtime installed. Install it with:" >&2
  echo "  xcodebuild -downloadPlatform iOS   (or -buildVersion <$want.x>)" >&2
  exit 1
fi
read -r runtime type <<<"$pick"

if [[ -n "$tests" ]]; then
  name="paddlesnitch-tests-${runtime##*.}"
  udid=$(xcrun simctl list devices --json | jq -r --arg rt "$runtime" --arg name "$name" '
    [.devices[$rt][]? | select(.isAvailable and .name == $name)] | first | .udid // empty')
  [[ -n "$udid" ]] || udid=$(xcrun simctl create "$name" "$type" "$runtime")
  echo "$udid"
  exit 0
fi
udid=$(xcrun simctl list devices --json | jq -r --arg rt "$runtime" --arg type "$type" '
  [.devices[$rt][]? | select(.isAvailable and .deviceTypeIdentifier == $type)] | first | .udid // empty')
if [[ -z "$udid" ]]; then
  udid=$(xcrun simctl create "paddlesnitch-${runtime##*.}" "$type" "$runtime")
fi
echo "$udid"
