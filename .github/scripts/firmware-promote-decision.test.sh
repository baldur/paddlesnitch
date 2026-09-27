#!/usr/bin/env bash
# Tests for firmware-promote-decision.sh. Run: bash .github/scripts/firmware-promote-decision.test.sh
set -euo pipefail
cd "$(dirname "$0")"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0

ch()  { printf '{"version":"%s","via":"%s","promotedAt":"%s"}' "$1" "$2" "$3" > "$t/channel.json"; }
man() { printf '{"version":"%s","builtAt":"%s"}' "$1" "$2" > "$t/manifest.json"; }
expect() { # <name> <want-prefix> <args...>
  local name="$1" want="$2"; shift 2
  local got; got="$(./firmware-promote-decision.sh "$@")"
  if [[ "$got" == "$want"* ]]; then echo "ok   $name"; else echo "FAIL $name: got '$got', want '$want…'"; fail=1; fi
}

man 0.14.0 2026-09-27T20:42:00Z
expect 'promotes when the channel has never been written (the stuck-0.12.0 bug)' promote 0.14.0 - "$t/manifest.json"

ch 0.14.0 merge 2026-09-27T21:00:00Z
expect 'skips when the version is already current' skip 0.14.0 "$t/channel.json" "$t/manifest.json"

ch 0.13.0 merge 2026-09-27T18:12:00Z
expect 'promotes a newer build over a merge-promoted channel' promote 0.14.0 "$t/channel.json" "$t/manifest.json"

ch 0.13.0 manual 2026-09-27T21:00:00Z
expect 'does not undo a rollback made after this build' skip 0.14.0 "$t/channel.json" "$t/manifest.json"

man 0.15.0 2026-09-27T22:00:00Z
expect 'promotes a build made after the rollback (the fix)' promote 0.15.0 "$t/channel.json" "$t/manifest.json"

exit $fail
