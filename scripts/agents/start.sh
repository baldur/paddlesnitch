#!/usr/bin/env bash
# Start a Claude session in a role. See docs/agents.md.
#   psa <role> [claude args...]   start it here, in this terminal
#   psa --tab <role>              (inside herdr) open it in a new tab, or go to it if it's already running
# Creates the role's worktree from origin/main if needed.
set -euo pipefail

MAIN="${PADDLESNITCH_REPO:-$HOME/Documents/Code/paddlesnitch.com}"
tab=false
if [ "${1:-}" = --tab ]; then tab=true; shift; fi
role="${1:-}"
roles() { git -C "$MAIN" ls-tree --name-only origin/main .claude/agents/ | sed 's|.*/||; s|\.md$||'; }
if [ "$role" = -h ] || [ "$role" = --help ]; then
  echo "usage: psa <role> [claude args...]   start a role in this terminal"
  echo "       psa --tab <role>              (inside herdr) open it in a new tab, or go to it if it's running"
  echo "roles:" $(roles)
  echo "Each role works in its own worktree, ../paddlesnitch-<role>. See docs/agents.md."
  exit 0
fi
if [ -z "$role" ]; then
  echo "usage: psa [--tab] <role>   (psa -h for more)   roles:" $(roles)
  exit 1
fi
shift
in_herdr=false
if [ "${HERDR_ENV:-}" = 1 ] && command -v herdr >/dev/null; then in_herdr=true; fi
if $tab && ! $in_herdr; then echo "--tab only works inside herdr"; exit 1; fi

git -C "$MAIN" fetch -q origin
if ! git -C "$MAIN" cat-file -e "origin/main:.claude/agents/$role.md" 2>/dev/null; then
  echo "no such role on main: $role (see docs/agents.md)"
  exit 1
fi

# Already running in herdr: go to it rather than starting a second one.
if $in_herdr && herdr agent get "$role" 2>/dev/null | jq -e .result >/dev/null 2>&1; then
  if $tab; then
    herdr agent focus "$role" >/dev/null
    echo "$role is already running; switched to it"
    exit 0
  fi
  echo "$role is already running in herdr (psa --tab $role switches to it)"
  exit 1
fi

# Every role, help included, gets its own worktree. help used to run in the
# main folder, but that is whatever the owner has checked out: on an old branch
# with no .claude/agents/ the session never started.
dir="$(dirname "$MAIN")/paddlesnitch-$role"
if [ ! -d "$dir" ]; then
  if git -C "$MAIN" show-ref -q --verify "refs/heads/role/$role"; then
    git -C "$MAIN" worktree add -q "$dir" "role/$role"
  else
    git -C "$MAIN" worktree add -q -b "role/$role" "$dir" origin/main
  fi
  echo "created worktree $dir"
fi
# help only reads and answers about the current setup: keep it on main.
if [ "$role" = help ] && git -C "$dir" diff --quiet && git -C "$dir" diff --cached --quiet; then
  git -C "$dir" merge -q --ff-only origin/main 2>/dev/null \
    || echo "note: $dir has commits that are not on main, so help may be out of date."
fi

if ! git -C "$dir" diff --quiet origin/main -- .claude/agents docs/agents.md 2>/dev/null; then
  echo "note: the agent briefs in $dir are behind main; the session will pick up the old brief until it updates."
fi

if $tab; then
  pane=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$dir" --label "$role" --no-focus | jq -r .result.root_pane.pane_id)
  herdr agent start "$role" --kind claude --pane "$pane" -- --agent "$role" -n "$role" "$@" >/dev/null
  echo "started $role in a new tab"
  exit 0
fi

if $in_herdr; then
  # Label this tab, and give the agent the role's name once herdr sees it, so
  # `herdr agent prompt <role> …` reaches it.
  herdr tab rename "$HERDR_TAB_ID" "$role" >/dev/null || true
  ( for _ in $(seq 30); do
      sleep 1
      herdr agent rename "$HERDR_PANE_ID" "$role" 2>/dev/null | jq -e .result >/dev/null && break
    done ) </dev/null >/dev/null 2>&1 &
fi

cd "$dir"
exec claude --agent "$role" -n "$role" "$@"
