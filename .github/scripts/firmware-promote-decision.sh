#!/usr/bin/env bash
# Should a merge to main promote firmware/VERSION to a channel?
#
#   firmware-promote-decision.sh <version> <channel.json|-> <manifest.json>
#
# <channel.json> is the channel's current pointer, or "-" when it does not exist
# yet. <manifest.json> is the published manifest of <version>. Prints
# "promote <reason>" or "skip <reason>"; exits non-zero only on bad input.
#
# Every merge promotes the latest build, EXCEPT one case: the channel was set by
# hand (a rollback) AFTER <version> was built. Re-promoting then would silently
# undo the rollback on the next unrelated merge. A version built after the
# rollback -- i.e. the fix -- still promotes.
set -euo pipefail

version="$1"; channel="$2"; manifest="$3"

if [ "$channel" = "-" ]; then
  echo "promote channel has no pointer yet"; exit 0
fi

current="$(jq -r '.version // empty' "$channel")"
via="$(jq -r '.via // empty' "$channel")"
promoted_at="$(jq -r '.promotedAt // empty' "$channel")"
built_at="$(jq -r '.builtAt // empty' "$manifest")"

if [ "$current" = "$version" ]; then
  echo "skip $version is already current"; exit 0
fi

# ISO-8601 UTC timestamps compare correctly as strings.
if [ "$via" = "manual" ] && [ -n "$built_at" ] && [ -n "$promoted_at" ] \
   && [[ ! "$built_at" > "$promoted_at" ]]; then
  echo "skip channel was set by hand to $current at $promoted_at, after $version was built ($built_at) -- bump firmware/VERSION to supersede the rollback"
  exit 0
fi

echo "promote $current -> $version"
