#!/usr/bin/env bash
# Sign a firmware build: prints the base64 DER ECDSA signature over the message
# the tracker checks (firmware/include/ota_sign.h), after verifying it against
# the public key compiled into the firmware. A key that does not match the one
# in the firmware would publish a release every tracker refuses, so that is an
# error here, before anything is uploaded.
#
# Usage: firmware-sign.sh <version> <sha256hex> <private-key.pem> <fw_signing_key.h>
set -euo pipefail
V="$1"; SHA="$2"; KEY="$3"; HDR="$4"
printf '%s' "$SHA" | grep -Eq '^[0-9a-fA-F]{64}$' || { echo "not a sha256: $SHA" >&2; exit 1; }
case "$V" in ''|*[[:space:]]*) echo "bad version: '$V'" >&2; exit 1;; esac
[ -s "$KEY" ] || { echo "no signing key" >&2; exit 1; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
SHA_LC="$(printf '%s' "$SHA" | tr 'A-F' 'a-f')"
printf 'paddlesnitch-firmware\n%s\n%s\n' "$V" "$SHA_LC" > "$T/msg"
openssl dgst -sha256 -sign "$KEY" -out "$T/sig" "$T/msg"

# The PEM lines inside the C string literals of the header.
sed -n 's/^ *"\(.*\)\\n"[;]*$/\1/p' "$HDR" > "$T/pub.pem"
grep -q 'BEGIN PUBLIC KEY' "$T/pub.pem" || { echo "no public key in $HDR" >&2; exit 1; }
openssl dgst -sha256 -verify "$T/pub.pem" -signature "$T/sig" "$T/msg" >/dev/null \
  || { echo "signing key does not match the key in $HDR -- trackers would refuse this release" >&2; exit 1; }

base64 < "$T/sig" | tr -d '\n'
