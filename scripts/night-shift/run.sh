#!/usr/bin/env bash
# Night shift runner (docs/night-shift/README.md). Loops: pick a job, give the
# local model one run of it, record the report.
#
# The boundary is sandbox.sb, not the model's permission rules: the model and
# everything it starts run under sandbox-exec with no network beyond localhost,
# no reading keys, tokens or shell profiles, and writes only to its own clone
# and ~/.paddlesnitch/night-shift. The clone has no remote. lead fetches its
# branches as data (refs/night/*) and opens any PR itself.
#
# Run it from main, so the copy that runs is one the model can't edit:
#   bash <(git -C ~/Documents/Code/paddlesnitch.com show origin/main:scripts/night-shift/run.sh)
# Options: --once, --job <name>, --shell <cmd…> (run a command in the sandbox,
# in the clone: how lead re-measures a branch).
# Stop: touch ~/.paddlesnitch/night-shift/pause
set -uo pipefail

MAIN=~/Documents/Code/paddlesnitch.com
CLONE=~/Documents/Code/paddlesnitch-night
NIGHT=~/.paddlesnitch/night-shift
JOBS=(views footage mutants sweep)
MODEL=${NIGHT_MODEL:-ollama/qwen3.8-64k:latest}
RUN_MINUTES=${NIGHT_RUN_MINUTES:-120}
ONCE=0; FORCE_JOB=; SHELL_CMD=()
while [ $# -gt 0 ]; do
  case $1 in
    --once) ONCE=1 ;;
    --job) FORCE_JOB=$2; shift ;;
    --shell) shift; SHELL_CMD=("$@"); break ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

mkdir -p "$NIGHT"/{inbox,done,footage,views,sweep,xdg,pnpm-store}
touch "$NIGHT/log.jsonl"
PROFILE="$NIGHT/.sandbox.sb"
say() { echo "[night $(date +%H:%M)] $*"; }

# Everything that touches the clone runs here, in a clean environment: no
# GitHub or AWS credentials; opencode's data and pnpm's store inside $NIGHT.
sb() {
  local net=0; [ "$1" = --net ] && { net=1; shift; }
  env -i HOME="$HOME" PATH="$PATH" USER="$USER" TERM="${TERM:-xterm}" LANG="${LANG:-en_GB.UTF-8}" \
    TMPDIR="${TMPDIR:-/tmp}" NEXT_TELEMETRY_DISABLED=1 \
    XDG_DATA_HOME="$NIGHT/xdg/data" XDG_STATE_HOME="$NIGHT/xdg/state" \
    XDG_CACHE_HOME="$NIGHT/xdg/cache" XDG_CONFIG_HOME="$NIGHT/xdg/config" \
    npm_config_store_dir="$NIGHT/pnpm-store" \
    sandbox-exec -f "$PROFILE" -D HOME="$HOME" -D CLONE="$CLONE" -D NIGHT="$NIGHT" -D NET="$net" "$@"
}

setup() {
  git -C "$MAIN" fetch -q origin || return 1
  # The profile comes from main on every run; a copy the model wrote is replaced.
  # It sits in $NIGHT, which the model can write, but it's only read here,
  # before the model starts.
  git -C "$MAIN" show origin/main:scripts/night-shift/sandbox.sb >"$PROFILE" || return 1
  if [ ! -d "$CLONE/.git" ]; then
    git clone -q --no-hardlinks "$MAIN" "$CLONE" || return 1
    git -C "$CLONE" remote remove origin
  fi
  # main's latest commit, as the branch "base"
  sb git -C "$CLONE" fetch -q "$MAIN" "+refs/remotes/origin/main:refs/heads/base"
}

pick_job() {
  [ -n "$FORCE_JOB" ] && { echo "$FORCE_JOB"; return; }
  local only
  only=$(grep -m1 -E '^only: *[a-z]+' "$NIGHT/steer.md" 2>/dev/null | sed -E 's/^only: *//')
  [ -n "$only" ] && { echo "$only"; return; }
  python3 -I - "$NIGHT/log.jsonl" "${JOBS[@]}" <<'PY'
import json, sys
last = {}
for line in open(sys.argv[1]):
    try: r = json.loads(line); last[r["job"]] = r["at"]
    except Exception: pass
print(min(sys.argv[2:], key=lambda j: last.get(j, "")))
PY
}

model_busy() {  # another model loaded (e.g. the overnight colour run)
  ollama ps 2>/dev/null | tail -n +2 | grep -v '^$' | grep -vq "${MODEL#ollama/}"
}

record() {  # append the report's front matter to log.jsonl
  python3 -I - "$1" "$2" "$3" "$NIGHT/log.jsonl" <<'PY'
import json, sys, datetime
report, job, branch, log = sys.argv[1:5]
fm = {"result": "no-report"}
try:
    text = open(report).read()
    if text.startswith("---"):
        for line in text.split("---")[1].splitlines()[:12]:
            if ":" in line:
                k, v = line.split(":", 1); fm[k.strip()[:20]] = v.strip()[:200]
except FileNotFoundError:
    pass
fm["job"], fm["branch"] = job, branch  # the runner's, not the report's
fm["at"] = datetime.datetime.now().isoformat(timespec="seconds")
fm["report"] = report
open(log, "a").write(json.dumps(fm) + "\n")
print(fm["result"], fm.get("metric", ""), fm.get("before", ""), "->", fm.get("after", ""))
PY
}

run_once() {
  setup || { say "setup failed"; return 1; }
  local job stamp branch report
  job=$(pick_job)
  case " ${JOBS[*]} " in *" $job "*) ;; *) say "unknown job '$job'"; return 1 ;; esac
  stamp=$(date +%Y%m%d-%H%M)
  branch="night/$job-$stamp"
  report="$NIGHT/inbox/$stamp-$job.md"

  sb git -C "$CLONE" reset -q --hard
  sb git -C "$CLONE" clean -qffd
  sb git -C "$CLONE" switch -q -C "$branch" base || return 1
  (cd "$CLONE" && sb --net pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1) || say "pnpm install failed"
  # The footage job reads a copy of the footage index, never the live one.
  [ "$job" = footage ] && sqlite3 ~/.paddlesnitch/footage/footage.db ".backup '$NIGHT/footage/footage.db'"

  say "job $job on $branch"
  local prompt="You are the night shift. Job: $job. Branch: $branch (already checked out). Report path: $report. Read docs/night-shift/README.md, then docs/night-shift/jobs/$job.md, and do exactly one run. Write the report before you stop."
  (cd "$CLONE" && sb perl -e 'alarm shift; exec @ARGV' $((RUN_MINUTES * 60)) \
    opencode run --standalone --agent night-shift -m "$MODEL" --auto --title "night $job $stamp" "$prompt") \
    >"$NIGHT/inbox/$stamp-$job.log" 2>&1
  say "opencode exited ($?)"
  pkill -f "$CLONE" 2>/dev/null  # anything it left running (a dev server)

  # Never run git unsandboxed in the clone: its .git/config is the model's
  # (core.fsmonitor and friends run commands).
  if [ -z "$(sb git -C "$CLONE" rev-list base..HEAD 2>/dev/null)" ]; then
    sb git -C "$CLONE" switch -q --detach base
    sb git -C "$CLONE" branch -q -D "$branch"
    branch=none
  fi
  say "$(record "$report" "$job" "$branch")"
}

if [ ${#SHELL_CMD[@]} -gt 0 ]; then
  setup || exit 1
  cd "$CLONE" && sb "${SHELL_CMD[@]}"
  exit $?
fi

while true; do
  if [ -e "$NIGHT/pause" ]; then say "paused (rm $NIGHT/pause to resume)"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  if ! curl -sf http://localhost:11434/api/tags >/dev/null; then say "Ollama isn't running"; [ $ONCE = 1 ] && exit 1; sleep 600; continue; fi
  if model_busy; then say "another model is busy; waiting"; [ $ONCE = 1 ] && exit 0; sleep 600; continue; fi
  run_once
  [ $ONCE = 1 ] && exit 0
  sleep 300
done
