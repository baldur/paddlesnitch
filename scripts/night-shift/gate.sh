#!/usr/bin/env bash
# lead runs this on a night-shift branch before cherry-picking anything from it
# (docs/night-shift/README.md, triage). It fails on anything that could carry
# the owner's footage or local paths into a public PR. It reads the diff only;
# it runs nothing from the branch.
#
#   bash scripts/night-shift/gate.sh refs/night/<branch> [base]
set -uo pipefail
ref=$1; base=${2:-origin/main}
fail=0
bad() { echo "GATE: $*"; fail=1; }

# Binary files or media of any kind.
git diff --numstat "$base...$ref" | awk '$1=="-" {print $3}' | while read -r f; do echo "GATE: binary file $f"; done | grep . && fail=1
git diff --name-only "$base...$ref" | grep -iE '\.(png|jpe?g|gif|webp|heic|mp4|mov|360|insv|lrv|avi|mkv|wav|mp3|db|sqlite)$' | sed 's/^/GATE: media or database file /' | grep . && fail=1

# Paths outside what the night shift may change.
git diff --name-only "$base...$ref" | grep -E '^(docs/night-shift/|scripts/night-shift/|\.opencode/|opencode\.json|\.claude/|\.github/|infra/|firmware/|mobile/|recorder-core/)|(^|/)CLAUDE\.md$|^docs/agents\.md$' \
  | grep -v '^scripts/night-shift/mutate\.mjs$' | sed 's/^/GATE: not the night shift'"'"'s to change: /' | grep . && fail=1

# Private data leaking through text: local paths, footage names, home folders,
# and long base64 blobs (an embedded image).
added=$(git diff "$base...$ref" | grep '^+' | grep -v '^+++')
echo "$added" | grep -nE '\.paddlesnitch/(refviews|footage|night-shift|materials)|footage\.db|/Users/|GX[0-9]{6}|GS[0-9]{6}|VID_[0-9]{8}' | sed 's/^/GATE: private path or footage name: /' | grep . && fail=1
echo "$added" | grep -nE '[A-Za-z0-9+/]{400,}' | cut -c1-120 | sed 's/^/GATE: long encoded blob: /' | grep . && fail=1

[ $fail = 0 ] && echo "gate: clean"
exit $fail
