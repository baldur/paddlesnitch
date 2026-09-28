#!/usr/bin/env bash
# Tests for release-tag.sh. Run: bash .github/scripts/release-tag.test.sh
set -euo pipefail
cd "$(dirname "$0")"
fail=0
ok()  { local got; got="$(./release-tag.sh "$2" "$3" 2>&1)" || { echo "FAIL $1: rejected: $got"; fail=1; return; }
        if [ "$got" = "$4" ]; then echo "ok   $1"; else echo "FAIL $1: got '$got', want '$4'"; fail=1; fi; }
bad() { if ./release-tag.sh "$2" "$3" >/dev/null 2>&1; then echo "FAIL $1: accepted"; fail=1; else echo "ok   $1"; fi; }

ok  'firmware'                 fw      0.16.2       fw/v0.16.2
ok  'a later app release'      ios     1.0.0        ios/v1.0.0
ok  'a pre-release'            android 1.2.0-beta.1 android/v1.2.0-beta.1
bad 'an unknown component'     firmware 0.16.2
bad 'a version with a v in it' fw      v0.16.2
bad 'a version with trailing text' fw  0.16.2x
bad 'no version'               fw      ''
exit $fail
