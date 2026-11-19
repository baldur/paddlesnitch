#!/usr/bin/env bash
# Remove git worktrees whose work is already on main. See docs/agents.md.
#   clean-worktrees.sh            list what it would remove and why it keeps the rest (changes nothing)
#   clean-worktrees.sh --apply    remove them, and delete their local branches
#
# A worktree is removed only if ALL of these hold:
#   - it isn't the main checkout, and it isn't locked (`git worktree lock <path>` keeps one for good)
#   - it isn't a role's home folder (../paddlesnitch-<role>, or branch role/<role>)
#   - it is older than CLEAN_WORKTREES_MIN_AGE_HOURS (default 24): a new, still
#     empty worktree is where an agent is about to start
#   - no running process has its current folder inside it
#   - git status shows nothing uncommitted, untracked files included
#   - its commit is on origin/main, or its branch's PR was merged INTO main and
#     the branch tip is the commit that PR merged (nothing committed after)
# Anything else is kept: no PR, an open or closed PR, a PR merged into another
# branch, commits after the merge.
# Gitignored files (.env.local, .local-data/, build output) are NOT checked and
# go with the folder. Lock a worktree whose ignored files matter.
#
# Env: PADDLESNITCH_REPO (default ~/Documents/Code/paddlesnitch.com).
# CLEAN_WORKTREES_MERGED: a JSON file of [{headRefName, headRefOid, baseRefName}]
# to use instead of asking GitHub (for tests).
set -euo pipefail

apply=false
case "${1:-}" in
  --apply) apply=true ;;
  "") ;;
  *) echo "usage: clean-worktrees.sh [--apply]"; exit 1 ;;
esac

MAIN="${PADDLESNITCH_REPO:-$HOME/Documents/Code/paddlesnitch.com}"
min_age_s=$(( ${CLEAN_WORKTREES_MIN_AGE_HOURS:-24} * 3600 ))
git -C "$MAIN" fetch -q origin

# The main checkout is the first entry of `git worktree list`.
main_dir=$(git -C "$MAIN" worktree list --porcelain | sed -n '1s/^worktree //p')
roles=$(git -C "$MAIN" ls-tree --name-only origin/main .claude/agents/ | sed 's|.*/||; s|\.md$||')
[ -n "$roles" ] || { echo "no roles found in origin/main:.claude/agents/; stopping"; exit 1; }

# Branch -> head commit of its PR merged into main, one line each.
if [ -n "${CLEAN_WORKTREES_MERGED:-}" ]; then
  merged_json=$(cat "$CLEAN_WORKTREES_MERGED")
else
  merged_json=$(cd "$MAIN" && gh pr list --state merged --base main --limit 5000 --json headRefName,headRefOid,baseRefName)
fi
merged=$(printf '%s' "$merged_json" | jq -r '.[] | select(.baseRefName == "main") | "\(.headRefName) \(.headRefOid)"')

# Every running process's current folder. Never empty when lsof works (this
# script's own shell is in it), so empty means lsof failed: stop rather than
# assume nothing is in use.
cwds=$(lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
[ -n "$cwds" ] || { echo "lsof listed no processes; can't tell which worktrees are in use, stopping"; exit 1; }

now=$(date +%s)
decide() { # path branch head locked admin -> prints "REMOVE|KEEP <reason>"
  local path=$1 branch=$2 head=$3 locked=$4 admin=$5 role created status
  [ "$path" = "$main_dir" ] && { echo "KEEP main checkout"; return; }
  [ "$locked" = 1 ] && { echo "KEEP locked"; return; }
  for role in $roles; do
    if [ "$(basename "$path")" = "paddlesnitch-$role" ] || [ "$branch" = "role/$role" ]; then
      echo "KEEP home folder of the $role role"; return
    fi
  done
  if [ -d "$path" ]; then
    # `commondir` is written once, when the worktree is added.
    # GNU stat first: on Linux `stat -f` means file-system status and succeeds.
    created=$(stat -c %Y "$admin/commondir" 2>/dev/null || stat -f %m "$admin/commondir" 2>/dev/null || true)
    case "$created" in ''|*[!0-9]*) created=$now ;; esac
    [ $(( now - created )) -ge "$min_age_s" ] || { echo "KEEP made less than $(( min_age_s / 3600 )) h ago"; return; }
    if printf '%s\n' "$cwds" | grep -qxF -e "$path" || printf '%s\n' "$cwds" | grep -qF -e "$path/"; then
      echo "KEEP a running process is using it"; return
    fi
    status=$(git -C "$path" status --porcelain 2>/dev/null) || { echo "KEEP git status failed"; return; }
    [ -z "$status" ] || { echo "KEEP has uncommitted changes"; return; }
  fi
  if git -C "$MAIN" merge-base --is-ancestor "$head" origin/main 2>/dev/null; then
    echo "REMOVE its commit is on main"; return
  fi
  [ -n "$branch" ] || { echo "KEEP detached at a commit not on main"; return; }
  local pr_head
  pr_head=$(printf '%s\n' "$merged" | awk -v b="$branch" '$1 == b { print $2 }')
  [ -n "$pr_head" ] || { echo "KEEP no PR for $branch merged into main"; return; }
  if printf '%s\n' "$pr_head" | grep -qxF -e "$head"; then
    echo "REMOVE PR for $branch is merged"; return
  fi
  echo "KEEP commits on $branch after its PR merged"
}

removed=0 kept=0 failed=0 branches=()
path="" head="" branch="" locked=0 admin=""
flush() {
  [ -n "$path" ] || return 0
  local verdict
  verdict=$(decide "$path" "$branch" "$head" "$locked" "$admin")
  if [ "${verdict%% *}" = REMOVE ] && $apply && [ -d "$path" ]; then
    if ! git -C "$MAIN" worktree remove "$path" 2>&1; then
      printf 'FAILED\t%s\t%s (git worktree remove failed)\n' "$path" "${verdict#* }"
      failed=$((failed + 1)); return 0
    fi
  fi
  printf '%s\t%s\t%s\n' "${verdict%% *}" "$path" "${verdict#* }"
  if [ "${verdict%% *}" = REMOVE ]; then
    removed=$((removed + 1))
    if [ -n "$branch" ]; then branches+=("$branch"); fi
  else
    kept=$((kept + 1))
  fi
}
while IFS= read -r line; do
  case "$line" in
    "worktree "*)
      flush
      path=${line#worktree }; head="" branch="" locked=0
      # Each linked worktree's admin folder is <common git dir>/worktrees/<name>;
      # its .git file points there.
      admin=$(sed -n 's/^gitdir: //p' "$path/.git" 2>/dev/null || true) ;;
    "HEAD "*) head=${line#HEAD } ;;
    "branch "*) branch=${line#branch refs/heads/} ;;
    locked*) locked=1 ;;
  esac
done < <(git -C "$MAIN" worktree list --porcelain)
flush

if $apply; then
  # Prune first, so branches of folders that were already gone are no longer
  # "checked out" and can be deleted.
  git -C "$MAIN" worktree prune
  for b in ${branches[@]+"${branches[@]}"}; do
    git -C "$MAIN" branch -D -q "$b" 2>/dev/null || echo "note: kept local branch $b (git refused to delete it)"
  done
  echo "removed $removed, kept $kept, failed $failed"
  [ "$failed" = 0 ] || exit 1
else
  echo "would remove $removed, keep $kept (run with --apply to remove)"
fi
