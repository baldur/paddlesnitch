#!/usr/bin/env bash
# Turns AutoFill Passwords off on one simulator, so iOS 26 doesn't offer
# "Save Password?" after every sign-in in the UI tests. Used by
# `make test-app` on its own simulator only (see the Makefile).
#   scripts/autofill-off.sh <udid>
#
# A shut-down simulator gets the setting in its preferences file before it
# boots: no race with a slow first boot (iOS 17 on CI creates its device).
# A booted one gets it through its own `defaults`.
set -euo pipefail
udid="$1"
state=$(xcrun simctl list devices --json \
  | jq -r --arg udid "$udid" '[.devices[][] | select(.udid == $udid)] | first | .state // empty')
case "$state" in
  Shutdown)
    # plutil, not the Mac's `defaults`: that goes through the Mac's own
    # preferences cache, which wrote the file too late for the boot.
    prefs="$HOME/Library/Developer/CoreSimulator/Devices/$udid/data/Library/Preferences"
    mkdir -p "$prefs"
    [[ -f "$prefs/com.apple.WebUI.plist" ]] || plutil -create binary1 "$prefs/com.apple.WebUI.plist"
    plutil -replace AutoFillPasswords -bool NO "$prefs/com.apple.WebUI.plist" ;;
  "")
    echo "No simulator $udid" >&2; exit 1 ;;
  *)
    xcrun simctl bootstatus "$udid" -b >/dev/null
    xcrun simctl spawn "$udid" defaults write com.apple.WebUI AutoFillPasswords -bool false ;;
esac
