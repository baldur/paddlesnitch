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
# Links (one named foo.ts can point at ~/.ssh), submodules, executables.
git diff --summary "$base...$ref" | grep -E 'mode (120000|160000|100755)' | sed 's/^/GATE: link, submodule or executable: /' | grep . && fail=1

added=$(git diff "$base...$ref" | grep '^+' | grep -v '^+++')
# Local paths and footage names. A script may name ~/.paddlesnitch on
# purpose; a frame or a footage file name never belongs in the repo.
echo "$added" | grep -nE 'paddlesnitch/(refviews|footage|night-shift|night-runner|materials)|footage\.db|/Users/|(GX|GS|GH|LRV_?|IMG_|PXL_|VID_)[0-9]{4,}|20[0-9]{2}-[0-9]{2}-[0-9]{2}[_ T][0-9]{2}' \
  | cut -c1-160 | sed 's/^/GATE: private path or footage name: /' | grep . && fail=1
# Embedded data: long lines, runs of encoded-looking lines, long number arrays.
echo "$added" | awk 'length($0) > 201 {print "GATE: line over 200 characters at +" NR ": " substr($0, 1, 80)}' | grep . && fail=1
n=$(echo "$added" | grep -cE '^\+[[:space:]]*["'"'"'`]?[A-Za-z0-9+/=]{60,}["'"'"'`,]*$')
[ "$n" -gt 3 ] && flag "$n lines that look like encoded data"
n=$(echo "$added" | grep -cE '([0-9.-]+, *){30,}')
[ "$n" -gt 0 ] && flag "$n lines with long number arrays"

# GPS-like numbers: three or more coordinates on one line (the owner's tracks).
n=$(echo "$added" | grep -cE '(-?[0-9]{1,3}\.[0-9]{4,}[^0-9].*){3,}')
[ "$n" -gt 0 ] && flag "$n lines with three or more coordinate-like numbers"

# Secrets: common token shapes, and the actual values in the owner's secret
# files and environment (compared, never printed).
echo "$added" | grep -nE 'github_pat_|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|xox[abp]-|[A-Fa-f0-9]{32,}' \
  | cut -d: -f1 | sed 's/^/GATE: looks like a secret (not shown) at added line /' | grep . && fail=1
secrets=$(mktemp); trap 'rm -f "$secrets"' EXIT
{
  for f in ~/Documents/Code/*/.env* ~/Documents/Code/*/apps/*/.env* ~/.zshrc; do
    [ -f "$f" ] && sed -nE 's/^(export +)?[A-Za-z_0-9]*(TOKEN|SECRET|KEY|PASSWORD|PAT)[A-Za-z_0-9]*=["'"'"']?([^"'"'"' ]{12,})["'"'"']?.*$/\3/p' "$f"
  done
  env | sed -nE 's/^[A-Za-z_0-9]*(TOKEN|SECRET|KEY|PASSWORD|PAT)[A-Za-z_0-9]*=(.{12,})$/\2/p'
} | sort -u >"$secrets"
if [ -s "$secrets" ] && echo "$added" | grep -qF -f "$secrets"; then
  flag "contains the value of one of the owner's secrets (not shown)"
fi

[ $fail = 0 ] && echo "gate: clean (now read every line)"
exit $fail
