#!/usr/bin/env bash
# Tests for blog-due.sh. Run: bash .github/scripts/blog-due.test.sh
set -euo pipefail
cd "$(dirname "$0")"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail=0
post() { printf -- '---\ntitle: %s\n%s---\nBody. draft: true\n' "$2" "$3" > "$t/$1"; }
post 2026-09-29-first.md First ''
post 2026-10-06-second.md Second ''
post 2026-10-01-unfinished.md Unfinished $'draft: true\n'
printf 'How to write a post.\n' > "$t/README.md"

expect() { # <name> <date> <want>
  local got; got="$(./blog-due.sh "$t" "$2" | tr '\n' ' ')"
  if [ "$got" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$got', want '$3'"; fail=1; fi
}
expect 'only what is dated on or before today'          2026-09-29 '/blog/2026/09/29/first '
expect 'a scheduled post falls due on its date'          2026-10-06 '/blog/2026/09/29/first /blog/2026/10/06/second '
expect 'drafts never, "draft: true" in the body ignored' 2026-12-31 '/blog/2026/09/29/first /blog/2026/10/06/second '
expect 'nothing before the first post'                   2026-01-01 ''
exit $fail
