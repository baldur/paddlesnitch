#!/usr/bin/env bash
# Start a Claude session in a role: psa <role> [claude args...]
# Creates the role's worktree from origin/main if needed. See docs/agents.md.
set -euo pipefail

MAIN="${PADDLESNITCH_REPO:-$HOME/Documents/Code/paddlesnitch.com}"
role="${1:-}"
if [ -z "$role" ]; then
  echo "usage: psa <role>   roles:" $(git -C "$MAIN" ls-tree --name-only origin/main .claude/agents/ | sed 's|.*/||; s|\.md$||')
  exit 1
fi
shift

git -C "$MAIN" fetch -q origin
if ! git -C "$MAIN" cat-file -e "origin/main:.claude/agents/$role.md" 2>/dev/null; then
  echo "no such role on main: $role (see docs/agents.md)"
  exit 1
fi

# help only reads, so it runs in the main folder; every other role gets its own worktree.
if [ "$role" = help ]; then
  dir="$MAIN"
else
  dir="$(dirname "$MAIN")/paddlesnitch-$role"
  if [ ! -d "$dir" ]; then
    if git -C "$MAIN" show-ref -q --verify "refs/heads/role/$role"; then
      git -C "$MAIN" worktree add -q "$dir" "role/$role"
    else
      git -C "$MAIN" worktree add -q -b "role/$role" "$dir" origin/main
    fi
    echo "created worktree $dir"
  fi
fi

if ! git -C "$dir" diff --quiet origin/main -- .claude/agents docs/agents.md 2>/dev/null; then
  echo "note: the agent briefs in $dir are behind main; the session will pick up the old brief until it updates."
fi

cd "$dir"
exec claude --agent "$role" -n "$role" "$@"
