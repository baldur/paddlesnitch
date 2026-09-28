#!/usr/bin/env bash
# Tests for firmware-notes.sh. Run: bash .github/scripts/firmware-notes.test.sh
set -euo pipefail
cd "$(dirname "$0")"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0

ok()  { # <name> <note file content> <want>
  printf '%s' "$2" > "$t/NOTES"
  local got; got="$(./firmware-notes.sh "$t/NOTES" 2>&1)" || { echo "FAIL $1: rejected: $got"; fail=1; return; }
  if [ "$got" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$got', want '$3'"; fail=1; fi
}
bad() { # <name> <note file content>
  printf '%s' "$2" > "$t/NOTES"
  if ./firmware-notes.sh "$t/NOTES" >/dev/null 2>&1; then echo "FAIL $1: accepted"; fail=1; else echo "ok   $1"; fi
}

ok  'prints a plain note' 'Setup screen shows the WiFi QR again' 'Setup screen shows the WiFi QR again'
ok  'drops the trailing newline an editor adds' $'New trackers get their own ID\n' 'New trackers get their own ID'
ok  'accepts 25 characters on one row' 'abcdefghij abcdefghij abc' 'abcdefghij abcdefghij abc'
ok  'accepts two full rows' 'abcdefghij abcdefghij abc abcdefghij abcdefghij abc' 'abcdefghij abcdefghij abc abcdefghij abcdefghij abc'
bad 'rejects a second row longer than 25' 'abcdefghij abcdefghij ab abcdefghij abcdefghij abcd'
bad 'rejects a short note that wraps early and overflows' 'abcde abcdefghijklmnopqrstuvwxyzabcd'
bad 'rejects a long word with nowhere to wrap' "$(printf 'x%.0s' {1..30})"
bad 'rejects the merge-commit subject that reached the screen' 'Merge pull request #295 from baldur/fw-unique-device-id'
bad 'rejects an empty note' ''
bad 'rejects a blank note' '   '
bad 'rejects two lines' $'one\ntwo'
bad 'rejects characters the screen font cannot draw' 'Don’t panic'
if ./firmware-notes.sh "$t/missing" >/dev/null 2>&1; then echo "FAIL rejects a missing file: accepted"; fail=1; else echo "ok   rejects a missing file"; fi

exit $fail
