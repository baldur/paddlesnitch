#!/usr/bin/env bash
# Print the release note for the tracker's "Updated to X" screen, or fail.
# Usage: firmware-notes.sh <path to firmware/NOTES>
#
# The note used to be the subject of the last commit. A merge commit made that
# "Merge pull request #295 from baldur/fw-unique-device-id" on the tracker's
# screen, and even a squash title ("fix(firmware): ...") is written for us, not
# for paddlers. So it is a file, written for the person holding the tracker.
#
# Rules come from the screen (ui.cpp drawOtaUpdated): the 5x8 font fits 25
# characters a row, and a longer note breaks at the last space in its first 26
# characters onto ONE more row. The same wrap is checked here, so a note that
# would run off the panel fails the release instead. The font has no accented
# or curly characters, so plain ASCII.
set -euo pipefail
f="$1"
[ -f "$f" ] || { echo "no release note at $f" >&2; exit 1; }
[ "$(grep -c '' "$f")" -le 1 ] || { echo "release note must be one line" >&2; exit 1; }
note="$(tr -d '\r\n' < "$f")"
[ -n "${note// /}" ] || { echo "release note is empty" >&2; exit 1; }
if [ "${#note}" -gt 25 ]; then
  head="${note:0:26}"; head="${head% *}"
  [ "$head" != "${note:0:26}" ] && [ -n "$head" ] || { echo "release note needs a space in its first 26 characters to wrap onto two rows" >&2; exit 1; }
  rest="${note:$(( ${#head} + 1 ))}"
  [ "${#rest}" -le 25 ] || { echo "release note wraps to '$head' / '$rest'; the second row is ${#rest} characters and the screen fits 25" >&2; exit 1; }
fi
LC_ALL=C grep -q '^[ -~]*$' <<<"$note" || { echo "release note must be plain ASCII (the screen font has no other characters)" >&2; exit 1; }
printf '%s' "$note"
