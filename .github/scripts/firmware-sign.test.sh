#!/usr/bin/env bash
# Tests for firmware-sign.sh. Run: bash .github/scripts/firmware-sign.test.sh
set -euo pipefail
cd "$(dirname "$0")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

openssl ecparam -name prime256v1 -genkey -noout -out "$T/key.pem" 2>/dev/null
openssl ecparam -name prime256v1 -genkey -noout -out "$T/other.pem" 2>/dev/null
{ echo 'static const char FW_SIGNING_PUBKEY[] ='
  openssl ec -in "$T/key.pem" -pubout 2>/dev/null | sed 's/.*/    "&\\n"/'
  echo ';'; } > "$T/key.h"

if SIG="$(./firmware-sign.sh 0.19.0 "$SHA" "$T/key.pem" "$T/key.h")"; then
  printf 'paddlesnitch-firmware\n0.19.0\n%s\n' "$SHA" > "$T/msg"
  printf '%s' "$SIG" | base64 -d > "$T/sig"
  openssl ec -in "$T/key.pem" -pubout -out "$T/pub.pem" 2>/dev/null
  if openssl dgst -sha256 -verify "$T/pub.pem" -signature "$T/sig" "$T/msg" >/dev/null; then echo "ok   signs the message the tracker checks"
  else echo "FAIL signature does not verify over the tracker's message"; fail=1; fi
else echo "FAIL a matching key was refused"; fail=1; fi

bad() { if ./firmware-sign.sh "$2" "$3" "$4" "$T/key.h" >/dev/null 2>&1; then echo "FAIL $1: accepted"; fail=1; else echo "ok   $1"; fi; }
bad 'a key that is not the one in the firmware' 0.19.0 "$SHA" "$T/other.pem"
bad 'no key at all (secret not set)'            0.19.0 "$SHA" "$T/missing.pem"
bad 'a hash that is not a sha256'               0.19.0 abc    "$T/key.pem"
bad 'an empty version'                          ''     "$SHA" "$T/key.pem"
exit $fail
