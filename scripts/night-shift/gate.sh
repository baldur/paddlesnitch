#!/usr/bin/env bash
# lead runs this on a night-shift branch before taking anything from it
# (docs/night-shift/README.md, triage). It reads the diff only; it runs
# nothing from the branch. Exit 0 means "clean enough to read closely", not
# "safe": lead still reads every line.
#
#   bash scripts/night-shift/gate.sh <ref> [base]
#
# lead takes the work as one squashed diff (git diff | git apply), so only the
# final tree matters, never a commit in between or a commit message.
set -uo pipefail
ref=$1; base=${2:-origin/main}
fail=0
flag() { echo "GATE: $*"; fail=1; }

files=$(git diff --name-only --no-renames "$base...$ref")

while IFS= read -r f; do
  [ -z "$f" ] && continue
  # Only source and test files. Anything else (images, JSON, CSV, GPX, SVG,
  # text) could carry footage, scores or tracks.
  case "$f" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs|*.css) ;;
    *) flag "file type not allowed: $f" ;;
  esac
  # What decides dependencies, configuration and what runs.
  case "$f" in
    package.json|*/package.json|pnpm-lock.yaml|pnpm-workspace.yaml|.npmrc|*/.npmrc|.pnpmfile.cjs|.gitattributes|.husky/*) flag "controls dependencies or hooks: $f" ;;
    apps/web/e2e/sweep/*) ;;  # the sweep job's own spec and config
    *.config.*) flag "a tool's configuration: $f" ;;
  esac
  # Other areas.
  case "$f" in
    scripts/night-shift/mutate.mjs) ;;
    docs/*|scripts/night-shift/*|.opencode/*|opencode.json|.claude/*|.github/*|infra/*|firmware/*|mobile/*|recorder-core/*|games/*|*CLAUDE.md)
      flag "not the night shift's to change: $f" ;;
  esac
done <<<"$files"
git diff --numstat "$base...$ref" | awk '$1=="-" {print "GATE: binary file " $3}' | grep . && fail=1

added=$(git diff "$base...$ref" | grep '^+' | grep -v '^+++')
# Local paths and footage names. A script may name ~/.paddlesnitch on
# purpose; a frame or a footage file name never belongs in the repo.
echo "$added" | grep -nE 'paddlesnitch/(refviews|footage|night-shift|night-runner|materials)|footage\.db|/Users/|(GX|GS|GH|LRV_?|IMG_|PXL_|VID_)[0-9]{4,}' \
  | cut -c1-160 | sed 's/^/GATE: private path or footage name: /' | grep . && fail=1
# Embedded data: long lines, runs of encoded-looking lines, long number arrays.
echo "$added" | awk 'length($0) > 201 {print "GATE: line over 200 characters at +" NR ": " substr($0, 1, 80)}' | grep . && fail=1
n=$(echo "$added" | grep -cE '^\+[[:space:]]*["'"'"'`]?[A-Za-z0-9+/=]{60,}["'"'"'`,]*$')
[ "$n" -gt 3 ] && flag "$n lines that look like encoded data"
n=$(echo "$added" | grep -cE '([0-9.-]+, *){30,}')
[ "$n" -gt 0 ] && flag "$n lines with long number arrays"

[ $fail = 0 ] && echo "gate: clean (now read every line)"
exit $fail
