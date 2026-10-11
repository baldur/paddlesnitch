#!/usr/bin/env bash
# Tests for enroll.py's parsing. Run: bash firmware/tools/enroll.test.sh
set -euo pipefail
cd "$(dirname "$0")"
fail=0
KEY="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null | openssl ec -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')"
RSA="$(openssl genrsa 1024 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')"

out="$(python3 enroll.py --line "IDENT 5A43CA48 435ABAB0 $KEY")"
n="$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
if [ "$n" = 2 ] && printf '%s' "$out" | grep -q "^5A43CA48	" && printf '%s' "$out" | grep -q "^435ABAB0	"; then
  echo "ok   enrols the ID in use and the unique ID"; else echo "FAIL two IDs: $out"; fail=1; fi
if printf '%s' "$out" | cut -f2 | head -1 | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["via"]=="cable" and d["publicKey"]' 2>/dev/null; then
  echo "ok   the record is what the server reads"; else echo "FAIL record shape"; fail=1; fi
out="$(python3 enroll.py --line "IDENT 435ABAB0 435ABAB0 $KEY")"
if [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1 ]; then echo "ok   one record when both IDs are the same"; else echo "FAIL duplicate"; fail=1; fi

bad() { if python3 enroll.py --line "$2" >/dev/null 2>&1; then echo "FAIL $1: accepted"; fail=1; else echo "ok   $1"; fi; }
bad 'a key that is not P-256'        "IDENT 435ABAB0 435ABAB0 $RSA"
bad 'no key (the tracker failed)'    "IDENT 435ABAB0 435ABAB0 -"
bad 'a lowercase or short ID'        "IDENT 435abab0 435ABAB0 $KEY"
bad 'some other line'                "STATUS ok"
exit $fail
