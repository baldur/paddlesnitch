#!/usr/bin/env bash
# Print the git tag for a release: <component>/v<semver>, e.g. fw/v0.16.2.
# Usage: release-tag.sh <component> <version>
#
# One convention for everything we ship from this repo, so each product's
# releases list on their own (`git tag -l 'fw/*'`) and a later iOS, Android or
# web release slots in without a new scheme. Add a component here when it
# starts releasing.
set -euo pipefail
component="${1:-}" version="${2:-}"
case "$component" in
  fw|ios|android|web) ;;
  *) echo "unknown component '$component' (fw, ios, android or web)" >&2; exit 1 ;;
esac
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
  || { echo "not a semver: '$version'" >&2; exit 1; }
printf '%s/v%s' "$component" "$version"
